import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';

const RESOURCE_LIMIT = 'COVERAGE_RESOURCE_LIMIT';
const sortByIdentity = (items, key) => [...items].sort((a, b) => {
  const left = key(a);
  const right = key(b);
  return left < right ? -1 : left > right ? 1 : 0;
});

function canonicalJson(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value !== 'object' || ancestors.has(value)) throw new TypeError('unsupported canonical value');
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new TypeError('unsupported canonical object');
  }
  ancestors.add(value);
  let serialized;
  if (Array.isArray(value)) {
    if (Reflect.ownKeys(value).length !== value.length + 1) {
      throw new TypeError('unsupported canonical array');
    }
    const items = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw new TypeError('unsupported canonical array');
      }
      items.push(canonicalJson(descriptor.value, ancestors));
    }
    serialized = `[${items.join(',')}]`;
  } else {
    serialized = `{${Reflect.ownKeys(value).sort().map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== 'string' || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw new TypeError('unsupported canonical property');
      }
      return `${JSON.stringify(key)}:${canonicalJson(descriptor.value, ancestors)}`;
    }).join(',')}}`;
  }
  ancestors.delete(value);
  return serialized;
}

/** SHA-256 of strictly serializable, recursively key-sorted JSON. */
export function canonicalDigest(value) {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

/** Build a complete, deterministically ordered snapshot; never truncate. */
export function buildCoverageSnapshot(model) {
  if (model.producers.length > 4096 || model.edges.length > 16384) throw new RangeError(RESOURCE_LIMIT);
  const snapshot = {
    ...model,
    scope: [...model.scope].sort(),
    workflows: sortByIdentity(model.workflows, (item) => item.path),
    producers: sortByIdentity(model.producers, (item) => item.id),
    gates: sortByIdentity(model.gates, (item) => item.id),
    edges: sortByIdentity(model.edges, (item) => canonicalJson([item.workflowPath, item.fromJobId, item.toJobId])),
    links: sortByIdentity(model.links, (item) => canonicalJson([item.producerId, item.gateId, item.kind])),
    schema: 'gategraph-coverage/1',
    complete: true,
  };
  snapshot.digest = canonicalDigest(snapshot);
  if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > 1024 * 1024) throw new RangeError(RESOURCE_LIMIT);
  return snapshot;
}

const SHA = /^[a-f0-9]{64}$/;
const nonempty = (value) => typeof value === 'string' && value.length > 0;
const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const keys = (value, expected) => plain(value) &&
  Object.keys(value).sort().join('\0') === [...expected].sort().join('\0');
const unique = (values) => new Set(values).size === values.length;
const array = (value, max) => Array.isArray(value) && value.length <= max;
const provider = (value) => keys(value, ['kind', 'integrationId']) && value.kind === 'github-app' &&
  Number.isSafeInteger(value.integrationId) && value.integrationId > 0;

function validSnapshot(snapshot) {
  try {
    if (!keys(snapshot, ['repository', 'sourceSha', 'targetRef', 'analysisContract', 'scope',
      'workflows', 'producers', 'gates', 'edges', 'links', 'policyFingerprint', 'observation',
      'schema', 'complete', 'digest']) || snapshot.schema !== 'gategraph-coverage/1' ||
      snapshot.complete !== true || !nonempty(snapshot.repository) || !nonempty(snapshot.sourceSha) ||
      !nonempty(snapshot.targetRef) || typeof snapshot.analysisContract !== 'string' ||
      !/^gategraph-audit\/v[1-9][0-9]*$/.test(snapshot.analysisContract) ||
      typeof snapshot.policyFingerprint !== 'string' || !SHA.test(snapshot.policyFingerprint) ||
      typeof snapshot.digest !== 'string' || !SHA.test(snapshot.digest) ||
      !array(snapshot.scope, 4096) || !array(snapshot.workflows, 4096) ||
      !array(snapshot.producers, 4096) || !array(snapshot.gates, 4096) ||
      !array(snapshot.edges, 16384) || !array(snapshot.links, 16384) ||
      snapshot.scope.some((path) => !nonempty(path)) || !unique(snapshot.scope)) return false;
    if (snapshot.workflows.some((w) => !keys(w, ['path', 'digest']) ||
      !snapshot.scope.includes(w.path) || typeof w.digest !== 'string' || !SHA.test(w.digest)) ||
      !unique(snapshot.workflows.map((w) => w.path))) return false;
    const producerIds = new Set();
    for (const p of snapshot.producers) {
      if (!keys(p, ['id', 'workflowPath', 'jobId', 'axes', 'checkName', 'provider', 'policy', 'coverage']) ||
        !snapshot.scope.includes(p.workflowPath) || !nonempty(p.jobId) || !nonempty(p.checkName) ||
        !plain(p.axes) || Object.keys(p.axes).length > 4 ||
        Object.values(p.axes).some((v) => !['string', 'number', 'boolean'].includes(typeof v) ||
          (typeof v === 'number' && !Number.isFinite(v))) || !provider(p.provider) ||
        !['voting', 'advisory', 'unknown'].includes(p.policy) ||
        !['direct', 'required-aggregate', 'uncovered', 'advisory', 'unknown'].includes(p.coverage) ||
        p.id !== canonicalDigest([p.workflowPath, p.jobId, p.axes, p.provider]) || producerIds.has(p.id)) return false;
      producerIds.add(p.id);
    }
    const gateIds = new Set();
    for (const g of snapshot.gates) {
      if (!keys(g, ['id', 'workflowPath', 'jobId', 'checkName', 'provider', 'sources']) ||
        !snapshot.scope.includes(g.workflowPath) || !nonempty(g.jobId) || !nonempty(g.checkName) ||
        !provider(g.provider) || !array(g.sources, 4096) || !g.sources.length ||
        g.sources.some((source) => !plain(source) || !['ruleset', 'classic-protection'].includes(source.kind) ||
          (source.kind === 'ruleset' ? !keys(source, ['kind', 'id']) || !nonempty(source.id) :
            !keys(source, ['kind', 'ref']) || source.ref !== snapshot.targetRef)) ||
        g.id !== canonicalDigest([g.workflowPath, g.jobId, g.checkName, g.provider]) || gateIds.has(g.id)) return false;
      gateIds.add(g.id);
    }
    if (snapshot.edges.some((edge) => !keys(edge, ['workflowPath', 'fromJobId', 'toJobId']) ||
      !snapshot.scope.includes(edge.workflowPath) || !nonempty(edge.fromJobId) || !nonempty(edge.toJobId)) ||
      !unique(snapshot.edges.map((e) => canonicalDigest(e)))) return false;
    for (const link of snapshot.links) {
      if (!keys(link, ['producerId', 'gateId', 'kind', 'evidence']) ||
        !producerIds.has(link.producerId) || !gateIds.has(link.gateId) ||
        !['direct', 'aggregate'].includes(link.kind)) return false;
      if (link.kind === 'direct') {
        if (!keys(link.evidence, ['sources']) || !array(link.evidence.sources, 4096)) return false;
      } else if (!keys(link.evidence, ['failurePropagation', 'evidenceFingerprint']) ||
        link.evidence.failurePropagation !== 'all-needs' ||
        !/^[a-f0-9]{12}$/.test(link.evidence.evidenceFingerprint)) return false;
    }
    const o = snapshot.observation;
    if (!keys(o, ['sourceSha', 'analyzedAt', 'subjectKind', 'evidenceKind', 'sources', 'runs', 'scope', 'policyInput']) ||
      o.sourceSha !== snapshot.sourceSha || !nonempty(o.analyzedAt) ||
      !['fixture', 'github'].includes(o.subjectKind) || o.evidenceKind !== 'observation-time' ||
      (o.subjectKind === 'github' && !/^[0-9a-f]{40}$/i.test(snapshot.sourceSha)) ||
      (o.subjectKind === 'fixture' && !/^fixture:[A-Za-z0-9._-]+$/.test(snapshot.sourceSha)) ||
      !array(o.sources, 4096) || !array(o.runs, 4096) ||
      o.sources.some((s) => !plain(s) || !nonempty(s.name) || !nonempty(s.outcome) || s.complete !== true) ||
      o.runs.some((r) => !plain(r) || !nonempty(r.runId) ||
        !snapshot.scope.includes(r.workflowPath) || r.sha !== snapshot.sourceSha)) return false;
    if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > 1024 * 1024) return false;
    const { digest, ...withoutDigest } = snapshot;
    return canonicalDigest(withoutDigest) === digest;
  } catch { return false; }
}

const unavailable = (reason) => ({ comparable: false, changes: [], before: null, after: null,
  unresolved: [reason] });
const provenance = (report) => ({ sourceSha: report.coverageSnapshot.sourceSha,
  observation: report.coverageSnapshot.observation });
const mapped = (items, field) => new Map(items.map((item) => [item[field], item]));
const stable = (value) => canonicalDigest(value);

/** Compare two independently validated, complete saved observations. */
export function compareCoverage(beforeReport, afterReport) {
  if (!plain(beforeReport) || !plain(afterReport) ||
    beforeReport.version !== 1 || afterReport.version !== 1) return unavailable('REPORT_VERSION_UNSUPPORTED');
  if (!['finding', 'policy-review', 'unknown', 'collection-error'].includes(beforeReport.status) ||
    !['finding', 'policy-review', 'unknown', 'collection-error'].includes(afterReport.status)) {
    return unavailable('REPORT_INVALID');
  }
  if (!beforeReport.coverageSnapshot || !afterReport.coverageSnapshot) return unavailable('SNAPSHOT_MISSING');
  if (beforeReport.status === 'collection-error' || afterReport.status === 'collection-error') {
    return unavailable('COLLECTION_INCOMPLETE');
  }
  if (!validSnapshot(beforeReport.coverageSnapshot) || !validSnapshot(afterReport.coverageSnapshot)) {
    return unavailable('SNAPSHOT_INVALID');
  }
  const a = beforeReport.coverageSnapshot;
  const b = afterReport.coverageSnapshot;
  if (a.repository !== b.repository) return unavailable('REPOSITORY_MISMATCH');
  if (a.targetRef !== b.targetRef) return unavailable('TARGET_REF_MISMATCH');
  if (a.analysisContract !== b.analysisContract) return unavailable('ANALYSIS_CONTRACT_MISMATCH');
  if (stable([...a.scope].sort()) !== stable([...b.scope].sort())) return unavailable('SCOPE_MISMATCH');
  const changes = [];
  for (const [name, field] of [['producer', 'producers'], ['gate', 'gates']]) {
    const left = mapped(a[field], 'id');
    const right = mapped(b[field], 'id');
    for (const id of left.keys()) if (!right.has(id)) changes.push({ kind: `${name}-removed`, id });
    for (const id of right.keys()) if (!left.has(id)) changes.push({ kind: `${name}-added`, id });
  }
  if (a.policyFingerprint !== b.policyFingerprint) changes.push({ kind: 'policy-changed',
    before: a.policyFingerprint, after: b.policyFingerprint });
  const links = (snapshot, id) => snapshot.links.filter((link) => link.producerId === id)
    .map((link) => stable(link)).sort();
  const afterProducers = mapped(b.producers, 'id');
  for (const p of a.producers) {
    const next = afterProducers.get(p.id);
    if (next && (p.coverage !== next.coverage || stable(links(a, p.id)) !== stable(links(b, p.id)))) {
      changes.push({ kind: 'coverage-changed', id: p.id, before: p.coverage, after: next.coverage });
    }
  }
  const afterWorkflows = mapped(b.workflows, 'path');
  for (const w of a.workflows) {
    const next = afterWorkflows.get(w.path);
    if (next && w.digest !== next.digest) changes.push({ kind: 'workflow-changed', path: w.path,
      before: w.digest, after: next.digest });
  }
  changes.sort((x, y) => stable(x).localeCompare(stable(y)));
  return { comparable: true, changes, before: provenance(beforeReport), after: provenance(afterReport),
    unresolved: [] };
}
