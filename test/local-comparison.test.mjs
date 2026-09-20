import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { auditControlPlane } from '../src/audit-control-plane.mjs';
import { createDemoInput } from '../src/demo-evidence.mjs';
import { applyAuthoredPolicy } from '../src/policy-input.mjs';
import { canonicalDigest, compareCoverage } from '../src/coverage-snapshot.mjs';
import { parseSavedReport, readSavedReport } from '../src/report-input.mjs';

const example = () => auditControlPlane(createDemoInput('finding'), { explain: true });
const reseal = (report) => {
  delete report.coverageSnapshot.digest;
  report.coverageSnapshot.digest = canonicalDigest(report.coverageSnapshot);
  return report;
};

function paginatedDemoInput(withTotal = true) {
  const input = createDemoInput('finding');
  const index = input.collection.sources.findIndex((source) => source.name === 'check-runs');
  const original = input.collection.sources[index];
  const page = (number, count) => ({ ...original, page: number, count, pagesComplete: true,
    ...(withTotal ? { totalCount: 3 } : {}) });
  input.collection.sources.splice(index, 1, page(1, 1), page(2, 2));
  const workflow = input.collection.sources.find((source) => source.name === 'workflow');
  Object.assign(workflow, { page: 1, count: 1, totalCount: 1, pagesComplete: true });
  return input;
}

test('real complete pagination groups remain comparable, with and without totalCount', async () => {
  for (const withTotal of [true, false]) {
    const report = await auditControlPlane(paginatedDemoInput(withTotal), { explain: true });
    assert.equal(report.coverageSnapshot.complete, true);
    assert.equal(compareCoverage(report, structuredClone(report)).comparable, true);
  }
});

test('resealed missing or contradictory pages fail like producer completeness checks', async () => {
  const input = paginatedDemoInput();
  const before = await auditControlPlane(input, { explain: true });
  assert.equal(before.status, 'finding');
  const missingInput = structuredClone(input);
  missingInput.collection.sources = missingInput.collection.sources.filter((source) => source.page !== 2);
  const producerResult = await auditControlPlane(missingInput, { explain: true });
  assert.equal(producerResult.status, 'collection-error');
  assert.equal(producerResult.results[0].reasonCode, 'EVIDENCE_INCOMPLETE');
  for (const mutate of [
    (sources) => sources.splice(sources.findIndex((source) => source.name === 'check-runs' && source.page === 2), 1),
    (sources) => { sources.find((source) => source.name === 'check-runs' && source.page === 2).page = 3; },
    (sources) => { sources.find((source) => source.name === 'check-runs' && source.page === 2).totalCount = 4; },
    (sources) => { delete sources.find((source) => source.name === 'check-runs' && source.page === 2).totalCount; },
  ]) {
    const after = structuredClone(before);
    mutate(after.coverageSnapshot.observation.sources);
    reseal(after);
    const compared = compareCoverage(before, after);
    assert.deepEqual(compared.unresolved, ['SNAPSHOT_INVALID']);
    assert.deepEqual(compared.changes, []);
  }
  const noTotal = await auditControlPlane(paginatedDemoInput(false), { explain: true });
  const saturated = structuredClone(noTotal);
  saturated.coverageSnapshot.observation.sources.find((source) =>
    source.name === 'check-runs' && source.page === 2).count = 100;
  reseal(saturated);
  assert.deepEqual(compareCoverage(noTotal, saturated).unresolved, ['SNAPSHOT_INVALID']);
});

async function selectedGithubReport(authored = false, selected = true) {
  const input = createDemoInput('finding');
  const repository = 'example/project';
  const sha = '0123456789abcdef0123456789abcdef01234567';
  const targetRef = 'refs/heads/main';
  const workflowPath = '.github/workflows/ci.yml';
  input.analysis.analyzedAt = '2026-09-05T06:01:00.000Z';
  input.subject = { kind: 'github', id: `${repository}@${sha}`, repository, sha, ref: targetRef,
    defaultBranchRef: targetRef };
  Object.assign(input.workflows[0], { path: workflowPath, sha });
  Object.assign(input.observedRuns[0], { runId: '501', workflowPath, runAttempt: 2, sha });
  for (const check of input.observedRuns[0].checkRuns) check.sha = sha;
  if (selected) input.collection.scope = { kind: 'selected-runs', repository, sha, targetRef,
    runIds: ['501'], excludedRunIds: [], excludedWorkflowPaths: [] };
  for (const source of input.collection.sources) {
    if (Object.hasOwn(source, 'sha')) source.sha = sha;
    if (Object.hasOwn(source, 'path')) source.path = workflowPath;
    if (Object.hasOwn(source, 'runId')) source.runId = '501';
  }
  input.policy.jobs = input.policy.jobs.map((job) => ({ ...job, workflowPath }));
  input.policy.gates = { [`${workflowPath}/gate`]: Object.values(input.policy.gates)[0] };
  if (!authored) return auditControlPlane(input, { explain: true });
  input.collection.sources.find((source) => source.name === 'policy').outcome = 'not-supplied';
  input.policy = { jobs: [] };
  const document = { contract: 'gategraph-authored-policy/v1',
    coordinate: { repository, sha, targetRef, runs: [{ runId: '501', workflowPath, runAttempt: 2 }] },
    review: { observedAt: '2026-09-05T06:00:00.000Z', evidence: 'synthetic-reviewed-gate-v1' },
    jobs: ['producer', 'dependency'].map((jobId) => ({ workflowPath, jobId, mergePolicy: 'voting' })),
    gates: { [`${workflowPath}/gate`]: { failurePropagation: 'all-needs', evidence: 'synthetic-propagation-v1' } } };
  return auditControlPlane(applyAuthoredPolicy(input, document), { explain: true });
}

test('actual selected and authored-policy producer contracts remain comparable', async () => {
  for (const authored of [false, true]) {
    const report = await selectedGithubReport(authored);
    assert.equal(report.coverageSnapshot.complete, true);
    assert.equal(report.coverageSnapshot.observation.scope.kind, 'selected-runs');
    assert.equal(report.coverageSnapshot.observation.policyInput === null, !authored);
    assert.equal(compareCoverage(report, structuredClone(report)).comparable, true);
  }
});

test('live-shaped observation without explicit selection retains null optional provenance', async () => {
  const report = await selectedGithubReport(false, false);
  assert.equal(report.coverageSnapshot.complete, true);
  assert.equal(report.coverageSnapshot.observation.subjectKind, 'github');
  assert.equal(report.coverageSnapshot.observation.scope, null);
  assert.equal(report.coverageSnapshot.observation.policyInput, null);
  assert.equal(compareCoverage(report, structuredClone(report)).comparable, true);
});

test('resealed missing source, run and malformed nullable provenance fail closed', async () => {
  const fixture = await example();
  const selected = await selectedGithubReport(true);
  for (const [base, mutate] of [
    [fixture, (s) => { s.observation.sources = []; }],
    [fixture, (s) => { s.observation.runs = []; }],
    [selected, (s) => { s.observation.sources.find((source) => source.name === 'workflow').path =
      '.github/workflows/other.yml'; }],
    [selected, (s) => { delete s.observation.sources.find((source) => source.name === 'check-runs').runId; }],
    [selected, (s) => { s.observation.scope = 123; }],
    [selected, (s) => { s.observation.policyInput = 'invalid'; }],
    [selected, (s) => { s.observation.scope.runIds = ['999']; }],
    [selected, (s) => { s.observation.policyInput.coordinate.runs[0].runAttempt = 1; }],
    [selected, (s) => { s.observation.policyInput.reviewedAt = '2026-09-05 06:00:00'; }],
  ]) {
    const after = structuredClone(base);
    mutate(after.coverageSnapshot);
    reseal(after);
    assert.deepEqual(compareCoverage(base, after).unresolved, ['SNAPSHOT_INVALID']);
    assert.deepEqual(compareCoverage(base, after).changes, []);
  }
});

test('resealed missing workflow digest cannot erase scoped workflow drift', async () => {
  const before = await example();
  const after = structuredClone(before);
  after.coverageSnapshot.workflows = [];
  reseal(after);
  assert.deepEqual(compareCoverage(before, after).unresolved, ['SNAPSHOT_INVALID']);
  assert.deepEqual(compareCoverage(before, after).changes, []);
});

test('resealed malformed direct sources and aggregate fingerprint cannot imply coverage', async () => {
  const before = await example();
  for (const [kind, mutate] of [
    ['direct', (link) => { link.evidence.sources = [false]; }],
    ['aggregate', (link) => { link.evidence.evidenceFingerprint = ['aaaaaaaaaaaa']; }],
  ]) {
    const after = structuredClone(before);
    mutate(after.coverageSnapshot.links.find((link) => link.kind === kind));
    reseal(after);
    assert.deepEqual(compareCoverage(before, after).unresolved, ['SNAPSHOT_INVALID']);
  }
});

test('reobservation timestamp and run order do not create drift', async () => {
  const before = await example();
  const after = structuredClone(before);
  after.coverageSnapshot.observation.analyzedAt = '2026-09-21T00:00:00Z';
  after.coverageSnapshot.observation.runs.reverse();
  reseal(after);
  assert.equal(compareCoverage(before, after).comparable, true);
  assert.deepEqual(compareCoverage(before, after).changes, []);
});

test('source SHA alone changes provenance, not modeled drift or either input', async () => {
  const before = await example();
  const after = structuredClone(before);
  const nextSha = 'fixture:gategraph-synthetic-demo-v2';
  after.coverageSnapshot.sourceSha = nextSha;
  after.coverageSnapshot.observation.sourceSha = nextSha;
  for (const run of after.coverageSnapshot.observation.runs) run.sha = nextSha;
  for (const source of after.coverageSnapshot.observation.sources) if (source.sha) source.sha = nextSha;
  reseal(after);
  const beforeHash = canonicalDigest(before);
  const afterHash = canonicalDigest(after);
  const result = compareCoverage(before, after);
  assert.equal(result.comparable, true);
  assert.deepEqual(result.changes, []);
  assert.equal(result.after.sourceSha, nextSha);
  assert.equal(canonicalDigest(before), beforeHash);
  assert.equal(canonicalDigest(after), afterHash);
});

test('legacy report is unavailable, not repaired', async () => {
  assert.deepEqual(compareCoverage(await example(), { version: 1, status: 'unknown', results: [] }).changes, []);
  assert.equal(compareCoverage(await example(), { version: 1, status: 'unknown', results: [] }).comparable, false);
});

test('escaped duplicate object keys are rejected', () => {
  assert.throws(() => parseSavedReport('{"version":1,"\\u0076ersion":1}'));
});

test('all seven change kinds are observable without claiming repair', async () => {
  const before = await example();
  const after = structuredClone(before);
  const snapshot = after.coverageSnapshot;
  const removed = snapshot.producers.pop();
  const added = { ...removed, jobId: 'new-producer', checkName: 'new-producer' };
  added.id = canonicalDigest([added.workflowPath, added.jobId, added.axes, added.provider]);
  snapshot.producers.push(added);
  const oldGate = snapshot.gates.pop();
  const addedGate = { ...oldGate, jobId: 'new-gate', checkName: 'new-gate' };
  addedGate.id = canonicalDigest([addedGate.workflowPath, addedGate.jobId, addedGate.checkName, addedGate.provider]);
  snapshot.gates.push(addedGate);
  snapshot.policyFingerprint = 'c'.repeat(64);
  snapshot.producers[0].coverage = 'uncovered';
  snapshot.workflows[0].digest = 'd'.repeat(64);
  snapshot.links = [];
  reseal(after);
  const result = compareCoverage(before, after);
  assert.equal(result.comparable, true);
  assert.deepEqual(new Set(result.changes.map((change) => change.kind)), new Set([
    'producer-added', 'producer-removed', 'gate-added', 'gate-removed', 'policy-changed',
    'coverage-changed', 'workflow-changed',
  ]));
  assert.equal(result.changes.some((change) => change.resolved === true), false);
});

test('mismatched coordinates and invalid digest are unavailable', async () => {
  const before = await example();
  for (const [field, value, expected] of [
    ['repository', 'other/repo', 'REPOSITORY_MISMATCH'],
    ['targetRef', 'refs/heads/other', 'TARGET_REF_MISMATCH'],
    ['analysisContract', 'gategraph-audit/v2', 'ANALYSIS_CONTRACT_MISMATCH'],
    ['scope', ['.github/workflows/other.yml'], 'SCOPE_MISMATCH'],
  ]) {
    const after = structuredClone(before);
    after.coverageSnapshot[field] = value;
    if (field === 'targetRef') {
      for (const source of after.coverageSnapshot.observation.sources) if (source.ref) source.ref = value;
    }
    if (field === 'scope') {
      after.coverageSnapshot.workflows[0].path = value[0];
      for (const p of after.coverageSnapshot.producers) p.workflowPath = value[0];
      for (const g of after.coverageSnapshot.gates) g.workflowPath = value[0];
      for (const e of after.coverageSnapshot.edges) e.workflowPath = value[0];
      for (const r of after.coverageSnapshot.observation.runs) r.workflowPath = value[0];
      for (const source of after.coverageSnapshot.observation.sources) if (source.path) source.path = value[0];
      for (const p of after.coverageSnapshot.producers) p.id = canonicalDigest([p.workflowPath,p.jobId,p.axes,p.provider]);
      for (const g of after.coverageSnapshot.gates) g.id = canonicalDigest([g.workflowPath,g.jobId,g.checkName,g.provider]);
      after.coverageSnapshot.links = [];
    }
    reseal(after);
    assert.deepEqual(compareCoverage(before, after).unresolved, [expected], field);
  }
  const bad = structuredClone(before);
  bad.coverageSnapshot.digest = '0'.repeat(64);
  assert.deepEqual(compareCoverage(before, bad).unresolved, ['SNAPSHOT_INVALID']);
});

test('collection error and missing snapshot never indicate resolution', async () => {
  const before = await example();
  const error = structuredClone(before);
  error.status = 'collection-error';
  assert.deepEqual(compareCoverage(before, error).unresolved, ['COLLECTION_INCOMPLETE']);
  assert.deepEqual(compareCoverage(before, { version: 1, status: 'finding' }).unresolved,
    ['SNAPSHOT_MISSING']);
});

test('consistent digest cannot launder malformed source identity or incomplete provenance', async () => {
  const before = await example();
  for (const mutate of [
    (report) => { report.coverageSnapshot.sourceSha = 'not-a-sha';
      report.coverageSnapshot.observation.sourceSha = 'not-a-sha'; },
    (report) => { report.coverageSnapshot.observation.sources[0].complete = false; },
    (report) => { report.coverageSnapshot.links[0].gateId = 'f'.repeat(64); },
    (report) => { report.coverageSnapshot.workflows[0].digest = ['f'.repeat(64)]; },
    (report) => { report.coverageSnapshot.policyFingerprint = ['f'.repeat(64)]; },
  ]) {
    const after = structuredClone(before);
    mutate(after);
    reseal(after);
    assert.deepEqual(compareCoverage(before, after).unresolved, ['SNAPSHOT_INVALID']);
  }
  const badStatus = structuredClone(before);
  badStatus.status = 'safe';
  assert.deepEqual(compareCoverage(before, badStatus).unresolved, ['REPORT_INVALID']);
});

test('a consistent forged digest is comparison data, not source authentication', async () => {
  const before = await example();
  const forged = structuredClone(before);
  forged.coverageSnapshot.policyFingerprint = 'e'.repeat(64);
  reseal(forged);
  assert.equal(compareCoverage(before, forged).comparable, true);
  assert.equal(compareCoverage(before, forged).changes.some((c) => c.kind === 'policy-changed'), true);
});

test('JSON preflight rejects malformed grammar, duplicate decoded keys and ceilings', () => {
  assert.throws(() => parseSavedReport('0'));
  assert.throws(() => parseSavedReport('[]'));
  for (const json of ['{"a":1,"\\u0061":2}', '{"a":{"x":1,"x":2}}',
    '{"a":01}', '{"x":"\\uXXXX"}', '{"x":1} trailing', '[1,]', '1e999',
    '['.repeat(34) + '0' + ']'.repeat(34),
    '{"a":[' + '0,'.repeat(50000) + '0]}',
    ' '.repeat(8 * 1024 * 1024) + '{"a":0}']) assert.throws(() => parseSavedReport(json), json.slice(0, 20));
  const exactArray = '[' + Array(50000).fill('0').join(',') + ']';
  assert.equal(parseSavedReport('{"a":' + exactArray + '}').a.length, 50000);
  const manyNodes = '{"a":[' + Array(4).fill(exactArray).join(',') + ']}';
  assert.throws(() => parseSavedReport(manyNodes));
  assert.deepEqual(parseSavedReport(' '.repeat(8 * 1024 * 1024 - 7) + '{"a":0}'), { a: 0 });
  assert.deepEqual(parseSavedReport('{"a":[1,true,null]}'), { a: [1,true,null] });
});

test('saved reader preserves bytes, rejects over-limit and symlink input', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gategraph-compare-'));
  const path = join(dir, 'report.json');
  await writeFile(path, '{"v":1}', { flag: 'wx' });
  const before = await readFile(path);
  assert.deepEqual(await readSavedReport(path), { v: 1 });
  assert.deepEqual(await readFile(path), before);
  const link = join(dir, 'link.json');
  await symlink(path, link);
  await assert.rejects(readSavedReport(link), /SAVED_REPORT_INVALID/);
  const huge = join(dir, 'huge.json');
  await writeFile(huge, ' '.repeat(8 * 1024 * 1024) + '0', { flag: 'wx' });
  await assert.rejects(readSavedReport(huge), /SAVED_REPORT_INVALID/);
});
