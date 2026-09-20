import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { parseDocument } from 'yaml';
import { expandStaticMatrix } from './static-matrix.mjs';

const ANALYZER = 'gategraph-ci';
const ANALYZER_VERSION = '0.2.0-experimental.1';
const ANALYSIS_CONTRACT = 'gategraph-audit/v1';
const ANALYZED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SHA_40 = /^[0-9a-f]{40}$/i;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BRANCH_REF = /^refs\/heads\/[A-Za-z0-9._\-\/]+$/;
const SAFE_ENDPOINT = /^repos\/[A-Za-z0-9._~%+?=&\-/]+$/;
const SAFE_POLICY_EVIDENCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:\/@-]{0,255}$/;
const MAX_WORKFLOW_BYTES = 1024 * 1024;
const MAX_AUDIT_WORKFLOW_BYTES = 4 * MAX_WORKFLOW_BYTES;
const MAX_JOBS_PER_WORKFLOW = 128;
const MAX_JOB_NAME_LENGTH = 1024;
const MAX_MATRIX_VALUES = 128;
const MAX_MATRIX_VALUE_LENGTH = 256;
const MAX_EXPANDED_NAME_LENGTH = 2048;
const MAX_AUDIT_EXPANDED_CHARS = 64 * 1024;
const RESOURCE_LIMIT_EXCEEDED = Symbol('resource-limit-exceeded');
const SAFE_SOURCE_REASON_CODES = new Set([
  'CLASSIC_PROTECTION_UNKNOWN',
  'ENDPOINT_NOT_ALLOWED',
  'GH_COLLECTION_FAILED',
  'RUN_LIFECYCLE_AMBIGUOUS',
  'TARGET_REF_UNRESOLVED',
  'TREE_TRUNCATED',
  'RUN_SELECTION_MISMATCH',
  'RUN_SELECTION_AMBIGUOUS',
  'TARGET_REF_MISMATCH',
  'POLICY_INPUT_INVALID',
  'POLICY_COORDINATE_MISMATCH',
]);
const COLLECTION_DIAGNOSTICS = new Map([
  ['POLICY_INPUT_INVALID', {
    message: 'Authored policy input is missing, malformed, oversized, or outside the reviewed contract',
    recoveryAction: 'Provide strict JSON within 64 KiB using the reviewed authored-policy schema and observation time.',
  }],
  ['POLICY_COORDINATE_MISMATCH', {
    message: 'Authored policy does not match the requested or observed audit coordinate',
    recoveryAction: 'Review policy for this exact repository, commit, target, workflow, run and attempt. No coordinate is overridden.',
  }],
  ['RUN_SELECTION_MISMATCH', {
    message: 'A selected run was not observed exactly once at the requested coordinate',
    recoveryAction: 'Select run IDs observed at this repository and commit. No other coordinate is searched.',
  }],
  ['RUN_SELECTION_AMBIGUOUS', {
    message: 'Multiple selected runs refer to the same workflow',
    recoveryAction: 'Select exactly one completed run per workflow.',
  }],
  ['TARGET_REF_MISMATCH', {
    message: 'The asserted target branch does not match observed run evidence',
    recoveryAction: 'Check the observed target branch. A target-ref option is an assertion, not a fallback.',
  }],
  ['TARGET_REF_UNRESOLVED', {
    message: 'The target branch could not be resolved from observed run evidence',
    recoveryAction: 'Select an observed run whose target branch is present in collected evidence. A target-ref option cannot supply a missing PR base.',
  }],
]);

/**
 * @typedef {object} AuditInput
 * @property {object} subject
 * @property {Array<{path: string, sha: string, text: string}>} workflows
 * @property {{rulesets: Array<object>, classicProtection: object}} controlPlane
 * @property {Array<object>} observedRuns
 * @property {{jobs: Array<object>, gates?: Record<string, object>}} policy
 * @property {{complete: boolean, sources: Array<object>, scope?: object, policyInput?: object}} collection
 * @property {{analyzer: string, version: string, contract: string, analyzedAt: string}} analysis
 */

/**
 * @typedef {object} AuditReport
 * @property {number} version
 * @property {'finding'|'policy-review'|'unknown'|'collection-error'} status
 * @property {object | null} subject
 * @property {Array<object>} results
 * @property {{analyzer?: string, version?: string, contract?: string, analyzedAt?: string, sources: Array<object>, gatePolicies?: Array<object>, coordinates?: object}} provenance
 */

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonemptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isProviderId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function normalizedAnalysis(analysis) {
  if (
    !isPlainObject(analysis) ||
    Object.keys(analysis).length !== 4 ||
    analysis.analyzer !== ANALYZER ||
    analysis.version !== ANALYZER_VERSION ||
    analysis.contract !== ANALYSIS_CONTRACT ||
    typeof analysis.analyzedAt !== 'string' ||
    !ANALYZED_AT.test(analysis.analyzedAt)
  ) {
    return null;
  }
  const timestamp = new Date(analysis.analyzedAt);
  if (!Number.isFinite(timestamp.getTime()) || timestamp.toISOString() !== analysis.analyzedAt) {
    return null;
  }
  return {
    analyzer: analysis.analyzer,
    version: analysis.version,
    contract: analysis.contract,
    analyzedAt: analysis.analyzedAt,
  };
}

function normalizedGatePolicyRecord(record) {
  if (
    !isPlainObject(record) ||
    Object.keys(record).length !== 2 ||
    !Object.hasOwn(record, 'failurePropagation') ||
    !Object.hasOwn(record, 'evidence') ||
    record.failurePropagation !== 'all-needs' ||
    typeof record.evidence !== 'string' ||
    !SAFE_POLICY_EVIDENCE_ID.test(record.evidence)
  ) {
    return null;
  }
  return {
    failurePropagation: record.failurePropagation,
    evidenceFingerprint: createHash('sha256').update(record.evidence, 'utf8').digest('hex').slice(0, 12),
  };
}

function safeSubject(input) {
  if (!isPlainObject(input?.subject)) return null;
  const subject = {};
  for (const key of ['kind', 'id', 'repository', 'ref', 'sha']) {
    if (isNonemptyString(input.subject[key])) subject[key] = input.subject[key];
  }
  return Object.keys(subject).length > 0 ? subject : null;
}

function safeSources(input) {
  if (!Array.isArray(input?.collection?.sources)) return [];
  const allowed = [
    'name', 'outcome', 'complete', 'pagesComplete', 'endpoint', 'sha', 'ref',
    'defaultBranchRef', 'path',
    'rulesetId', 'runId', 'page', 'count', 'totalCount', 'providerId',
  ];
  return input.collection.sources.flatMap((source) => {
    if (!isPlainObject(source)) return [];
    const safe = {};
    for (const key of allowed) {
      const value = source[key];
      if (key === 'endpoint' && (
        typeof value !== 'string' || value.length > 2048 || !SAFE_ENDPOINT.test(value)
      )) {
        continue;
      }
      if (['string', 'number', 'boolean'].includes(typeof value)) safe[key] = value;
    }
    if (SAFE_SOURCE_REASON_CODES.has(source.reasonCode)) safe.reasonCode = source.reasonCode;
    return Object.keys(safe).length > 0 ? [safe] : [];
  });
}

function safeGatePolicies(gatePolicies) {
  if (!(gatePolicies instanceof Map)) return [];
  return [...gatePolicies].map(([gateId, record]) => ({ gateId, ...record }));
}

function safeCoordinates(input) {
  const subject = safeSubject(input);
  if (!subject) return undefined;
  const workflows = Array.isArray(input?.workflows)
    ? input.workflows.flatMap((workflow) => (
      isPlainObject(workflow) && isNonemptyString(workflow.path) && isNonemptyString(workflow.sha)
        ? [{ path: workflow.path, sha: workflow.sha }]
        : []
    ))
    : [];
  const runs = Array.isArray(input?.observedRuns)
    ? input.observedRuns.flatMap((run) => (
      isPlainObject(run) && isNonemptyString(run.runId) && isNonemptyString(run.sha)
        ? [{ runId: run.runId, sha: run.sha, workflowPath: run.workflowPath }]
        : []
    ))
    : [];
  return { subject, workflows, runs };
}

function canonicalWorkflowPath(path) {
  return typeof path === 'string' && /^\.github\/workflows\/.+\.ya?ml$/.test(path) &&
    !path.includes('\\') && path.split('/').every((part) => part && part !== '.' && part !== '..');
}

function normalizedScope(input) {
  const scope = input?.collection?.scope;
  const keys = ['kind', 'repository', 'sha', 'targetRef', 'runIds', 'excludedRunIds', 'excludedWorkflowPaths'];
  const validIds = (ids, nonempty = false) => Array.isArray(ids) && (!nonempty || ids.length > 0) &&
    [...ids].every((id) => typeof id === 'string' && /^[1-9][0-9]*$/.test(id) && Number.isSafeInteger(Number(id))) &&
    new Set(ids).size === ids.length;
  if (!isPlainObject(scope) || ![Object.prototype, null].includes(Object.getPrototypeOf(scope)) ||
    Reflect.ownKeys(scope).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(scope, key)) || !isPlainObject(input.subject) ||
    scope.kind !== 'selected-runs' || input.subject.kind !== 'github' ||
    typeof scope.repository !== 'string' || !REPOSITORY.test(scope.repository) || scope.repository !== input.subject.repository ||
    typeof scope.sha !== 'string' || !SHA_40.test(scope.sha) || scope.sha !== input.subject.sha ||
    typeof scope.targetRef !== 'string' || !BRANCH_REF.test(scope.targetRef) || scope.targetRef !== input.subject.ref ||
    input.subject.id !== `${scope.repository}@${scope.sha}` ||
    (input.subject.defaultBranchRef !== undefined && (!isNonemptyString(input.subject.defaultBranchRef) ||
      !BRANCH_REF.test(input.subject.defaultBranchRef))) ||
    !validIds(scope.runIds, true) || !validIds(scope.excludedRunIds) ||
    scope.excludedRunIds.some((id) => scope.runIds.includes(id)) ||
    !Array.isArray(scope.excludedWorkflowPaths) || ![...scope.excludedWorkflowPaths].every(canonicalWorkflowPath) ||
    new Set(scope.excludedWorkflowPaths).size !== scope.excludedWorkflowPaths.length ||
    !Array.isArray(input.observedRuns) || input.observedRuns.length !== scope.runIds.length ||
    !validIds(input.observedRuns.map((run) => run?.runId), true) ||
    !input.observedRuns.every((run) => scope.runIds.includes(run.runId)) ||
    !Array.isArray(input.workflows) || ![...input.workflows].every((workflow) => canonicalWorkflowPath(workflow?.path)) ||
    input.workflows.some((workflow) => scope.excludedWorkflowPaths.includes(workflow.path))) return null;
  return {
    kind: scope.kind, repository: scope.repository, sha: scope.sha, targetRef: scope.targetRef,
    runIds: [...scope.runIds].sort(), excludedRunIds: [...scope.excludedRunIds].sort(),
    excludedWorkflowPaths: [...scope.excludedWorkflowPaths].sort(),
  };
}

function normalizedPolicyInput(input) {
  const policy = input?.collection?.policyInput;
  const keys = (value, expected) => isPlainObject(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)) &&
    Reflect.ownKeys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
  const scope = normalizedScope(input);
  const analysis = normalizedAnalysis(input?.analysis);
  if (!scope || !analysis || input.subject?.kind !== 'github' ||
    !keys(policy, ['contract', 'coordinate', 'reviewedAt', 'evidenceFingerprint', 'documentFingerprint']) ||
    policy.contract !== 'gategraph-authored-policy/v1' ||
    !keys(policy.coordinate, ['repository', 'sha', 'targetRef', 'runs']) ||
    policy.coordinate.repository !== scope.repository || policy.coordinate.sha !== scope.sha ||
    policy.coordinate.targetRef !== scope.targetRef ||
    typeof policy.reviewedAt !== 'string' || !ANALYZED_AT.test(policy.reviewedAt) ||
    !Number.isFinite(Date.parse(policy.reviewedAt)) || Date.parse(policy.reviewedAt) <= 0 ||
    new Date(policy.reviewedAt).toISOString() !== policy.reviewedAt ||
    Date.parse(policy.reviewedAt) > Date.parse(analysis.analyzedAt) ||
    !['evidenceFingerprint', 'documentFingerprint'].every((key) => typeof policy[key] === 'string' && /^[0-9a-f]{12}$/.test(policy[key])) ||
    !Array.isArray(policy.coordinate.runs) || policy.coordinate.runs.length !== input.observedRuns.length) return null;
  const runs = [...policy.coordinate.runs];
  if (!runs.every((run) => keys(run, ['runId', 'workflowPath', 'runAttempt']) &&
    scope.runIds.includes(run.runId) && Number.isSafeInteger(run.runAttempt) && run.runAttempt > 0 &&
    canonicalWorkflowPath(run.workflowPath) && input.workflows.some((workflow) => workflow.path === run.workflowPath) &&
    input.observedRuns.filter((observed) => observed.runId === run.runId && observed.workflowPath === run.workflowPath &&
      observed.runAttempt === run.runAttempt).length === 1) || new Set(runs.map((run) => run.runId)).size !== runs.length ||
    new Set(runs.map((run) => run.workflowPath)).size !== runs.length) return null;
  return { contract: policy.contract,
    coordinate: { repository: scope.repository, sha: scope.sha, targetRef: scope.targetRef,
      runs: runs.map((run) => ({ runId: run.runId, workflowPath: run.workflowPath, runAttempt: run.runAttempt }))
        .sort((left, right) => left.runId < right.runId ? -1 : left.runId > right.runId ? 1 : 0) },
    reviewedAt: policy.reviewedAt, evidenceFingerprint: policy.evidenceFingerprint, documentFingerprint: policy.documentFingerprint };
}

function provenance(input, gatePolicyEvidence) {
  const analysis = normalizedAnalysis(input?.analysis);
  const coordinates = safeCoordinates(input);
  const gatePolicies = safeGatePolicies(gatePolicyEvidence);
  const scope = normalizedScope(input);
  const policyInput = normalizedPolicyInput(input);
  return {
    ...(analysis ?? {}),
    sources: safeSources(input),
    ...(gatePolicies.length > 0 ? { gatePolicies } : {}),
    ...(coordinates ? { coordinates } : {}),
    ...(scope ? { scope } : {}),
    ...(policyInput ? { policyInput } : {}),
  };
}

function collectionError(input, reasonCode, message, details = {}) {
  const diagnostic = COLLECTION_DIAGNOSTICS.get(reasonCode);
  const result = {
    status: 'collection-error',
    reasonCode,
    message: diagnostic?.message ?? message,
    ...(diagnostic ? { recoveryAction: diagnostic.recoveryAction } : {}),
    unresolvedPremises: Array.isArray(details.unresolvedPremises)
      ? details.unresolvedPremises.filter(isNonemptyString)
      : [],
  };
  if (isNonemptyString(details.workflowPath)) result.workflowPath = details.workflowPath;
  if (
    isPlainObject(details.location) &&
    Number.isInteger(details.location.line) &&
    Number.isInteger(details.location.column)
  ) {
    result.location = { line: details.location.line, column: details.location.column };
  }
  return {
    version: 1,
    status: 'collection-error',
    subject: safeSubject(input),
    results: [result],
    provenance: provenance(input),
  };
}

function incompleteReason(input) {
  if (!Array.isArray(input?.collection?.sources)) return 'EVIDENCE_INCOMPLETE';
  const source = input.collection.sources.find((item) => (
    isPlainObject(item) && SAFE_SOURCE_REASON_CODES.has(item.reasonCode)
  ));
  return source?.reasonCode ?? 'EVIDENCE_INCOMPLETE';
}

function validateCanonicalInput(input) {
  if (!normalizedAnalysis(input.analysis)) {
    return { reasonCode: 'EVIDENCE_INCOMPLETE', premise: 'ANALYSIS_METADATA_INVALID' };
  }
  const subject = input.subject;
  if (
    !isPlainObject(subject) ||
    !['fixture', 'github'].includes(subject.kind) ||
    !isNonemptyString(subject.id) ||
    !isNonemptyString(subject.repository) ||
    !REPOSITORY.test(subject.repository) ||
    !isNonemptyString(subject.sha)
  ) {
    return { reasonCode: 'EVIDENCE_INCOMPLETE', premise: 'INVALID_SUBJECT_COORDINATE' };
  }
  if (
    subject.kind === 'github' &&
    (!SHA_40.test(subject.sha) || subject.id !== `${subject.repository}@${subject.sha}`)
  ) {
    return { reasonCode: 'EVIDENCE_INCOMPLETE', premise: 'INVALID_SUBJECT_COORDINATE' };
  }
  if (
    subject.defaultBranchRef !== undefined &&
    (!isNonemptyString(subject.defaultBranchRef) || !BRANCH_REF.test(subject.defaultBranchRef))
  ) {
    return { reasonCode: 'EVIDENCE_INCOMPLETE', premise: 'INVALID_DEFAULT_BRANCH_COORDINATE' };
  }

  const failedSource = input.collection?.complete === false && Array.isArray(input.collection.sources)
    ? input.collection.sources.find((source) => isPlainObject(source) &&
      source.complete === false &&
      ['failed', 'incomplete', 'unknown'].includes(source.outcome) &&
      SAFE_SOURCE_REASON_CODES.has(source.reasonCode))
    : undefined;
  if (failedSource) return { reasonCode: failedSource.reasonCode, premise: 'COLLECTION_NOT_COMPLETE' };
  if (!isNonemptyString(subject.ref) || !BRANCH_REF.test(subject.ref)) {
    return { reasonCode: 'EVIDENCE_INCOMPLETE', premise: 'INVALID_SUBJECT_COORDINATE' };
  }
  if (input.collection?.scope !== undefined && !normalizedScope(input)) {
    return { reasonCode: 'SCOPE_COORDINATE_MISMATCH', premise: 'SCOPE_COORDINATE_MISMATCH' };
  }
  if (input.collection?.policyInput !== undefined && !normalizedPolicyInput(input)) {
    return { reasonCode: 'POLICY_COORDINATE_MISMATCH', premise: 'POLICY_PROVENANCE_INVALID' };
  }

  if (
    !isPlainObject(input.collection) ||
    input.collection.complete !== true ||
    !Array.isArray(input.collection.sources) ||
    input.collection.sources.length === 0
  ) {
    return { reasonCode: incompleteReason(input), premise: 'COLLECTION_NOT_COMPLETE' };
  }
  for (const source of input.collection.sources) {
    if (
      !isPlainObject(source) ||
      !isNonemptyString(source.name) ||
      !isNonemptyString(source.outcome) ||
      source.complete !== true ||
      source.pagesComplete === false ||
      (source.endpoint !== undefined && (
        !isNonemptyString(source.endpoint) ||
        source.endpoint.length > 2048 ||
        !SAFE_ENDPOINT.test(source.endpoint)
      )) ||
      (source.outcome !== 'observed' && !(source.name === 'policy' && source.outcome === 'not-supplied'))
    ) {
      return { reasonCode: incompleteReason(input), premise: 'SOURCE_OUTCOME_INCOMPLETE' };
    }
    if (
      (source.sha !== undefined && source.sha !== subject.sha) ||
      (source.ref !== undefined && source.ref !== subject.ref) ||
      (
        source.defaultBranchRef !== undefined &&
        source.defaultBranchRef !== subject.defaultBranchRef
      )
    ) {
      return { reasonCode: 'EVIDENCE_INCOMPLETE', premise: 'SOURCE_COORDINATE_MISMATCH' };
    }
    if (
      source.name === 'repository' &&
      (source.ref !== undefined || source.defaultBranchRef === undefined)
    ) {
      return { reasonCode: 'EVIDENCE_INCOMPLETE', premise: 'SOURCE_COORDINATE_MISMATCH' };
    }
  }
  const sourceNames = new Set(input.collection.sources.map((source) => source.name));
  const requiredSourceGroups = [
    ['workflow'],
    ['control-plane', 'ruleset', 'rulesets', 'classic-protection'],
    ['observed-runs', 'actions-runs', 'jobs', 'check-run', 'check-runs'],
    ['policy'],
  ];
  if (requiredSourceGroups.some((group) => !group.some((name) => sourceNames.has(name)))) {
    return { reasonCode: 'EVIDENCE_INCOMPLETE', premise: 'REQUIRED_SOURCE_OUTCOME_MISSING' };
  }
  const paginationGroups = new Map();
  for (const source of input.collection.sources) {
    const hasPagination = source.page !== undefined || source.count !== undefined || source.totalCount !== undefined;
    if (!hasPagination) continue;
    if (
      !Number.isSafeInteger(source.page) ||
      source.page < 1 ||
      !Number.isSafeInteger(source.count) ||
      source.count < 0 ||
      (source.totalCount !== undefined && (!Number.isSafeInteger(source.totalCount) || source.totalCount < 0))
    ) {
      return { reasonCode: 'EVIDENCE_INCOMPLETE', premise: 'PAGINATION_METADATA_INVALID' };
    }
    const key = `${source.name}\0${source.runId ?? ''}\0${source.sha ?? ''}`;
    if (!paginationGroups.has(key)) paginationGroups.set(key, []);
    paginationGroups.get(key).push(source);
  }
  for (const pages of paginationGroups.values()) {
    pages.sort((left, right) => left.page - right.page);
    const hasTotal = pages.some((page) => page.totalCount !== undefined);
    const invalidSequence = pages.some((page, index) => page.page !== index + 1);
    const invalidTotal = hasTotal
      ? (
        pages.some((page) => page.totalCount === undefined) ||
        new Set(pages.map((page) => page.totalCount)).size !== 1 ||
        pages.reduce((sum, page) => sum + page.count, 0) !== pages[0].totalCount
      )
      : pages.at(-1).count >= 100;
    if (invalidSequence || invalidTotal) {
      return { reasonCode: 'EVIDENCE_INCOMPLETE', premise: 'PAGINATION_NOT_COMPLETE' };
    }
  }

  if (!Array.isArray(input.workflows) || input.workflows.length === 0) {
    return { reasonCode: 'EVIDENCE_INCOMPLETE', premise: 'WORKFLOWS_MISSING' };
  }
  const workflowPaths = new Set();
  for (const workflow of input.workflows) {
    if (
      !isPlainObject(workflow) ||
      !isNonemptyString(workflow.path) ||
      workflowPaths.has(workflow.path) ||
      workflow.sha !== subject.sha ||
      typeof workflow.text !== 'string'
    ) {
      return { reasonCode: 'EVIDENCE_INCOMPLETE', premise: 'WORKFLOW_COORDINATE_MISMATCH' };
    }
    workflowPaths.add(workflow.path);
  }
  if (input.collection.sources.some((source) => (
    source.path !== undefined && !workflowPaths.has(source.path)
  ))) {
    return { reasonCode: 'EVIDENCE_INCOMPLETE', premise: 'SOURCE_WORKFLOW_COORDINATE_MISMATCH' };
  }

  if (
    !isPlainObject(input.controlPlane) ||
    !Array.isArray(input.controlPlane.rulesets) ||
    !input.controlPlane.rulesets.every(isPlainObject) ||
    !isPlainObject(input.controlPlane.classicProtection)
  ) {
    return { reasonCode: 'EVIDENCE_INCOMPLETE', premise: 'CONTROL_PLANE_MISSING' };
  }
  if (
    !Array.isArray(input.observedRuns) ||
    input.observedRuns.length === 0 ||
    !input.observedRuns.every((run) => (
      isPlainObject(run) &&
      Array.isArray(run.checkRuns) &&
      run.checkRuns.every(isPlainObject)
    ))
  ) {
    return { reasonCode: 'EVIDENCE_INCOMPLETE', premise: 'OBSERVED_RUNS_MISSING' };
  }
  const runIds = new Set(input.observedRuns.map((run) => run.runId));
  if (input.collection.sources.some((source) => (
    source.runId !== undefined && !runIds.has(source.runId)
  ))) {
    return { reasonCode: 'EVIDENCE_INCOMPLETE', premise: 'SOURCE_RUN_COORDINATE_MISMATCH' };
  }
  if (
    !isPlainObject(input.policy) ||
    !Array.isArray(input.policy.jobs) ||
    (input.policy.gates !== undefined && !isPlainObject(input.policy.gates))
  ) {
    return { reasonCode: 'EVIDENCE_INCOMPLETE', premise: 'POLICY_SHAPE_INVALID' };
  }
  if (
    (
      input.policy.jobs.length > 0 ||
      (isPlainObject(input.policy.gates) && Object.keys(input.policy.gates).length > 0)
    ) &&
    input.collection.sources.some((source) => source.name === 'policy' && source.outcome === 'not-supplied')
  ) {
    return { reasonCode: 'EVIDENCE_INCOMPLETE', premise: 'POLICY_SOURCE_CONTRADICTS_INPUT' };
  }
  return null;
}

function triggerEvents(value) {
  const trigger = value?.on;
  if (isNonemptyString(trigger)) return new Set([trigger]);
  if (Array.isArray(trigger) && trigger.length > 0 && trigger.every(isNonemptyString)) {
    return new Set(trigger);
  }
  if (isPlainObject(trigger) && Object.keys(trigger).length > 0 && Object.keys(trigger).every(isNonemptyString)) {
    return new Set(Object.keys(trigger));
  }
  return null;
}

function normalizedJob(workflowPath, jobId, job, budget) {
  if (!isPlainObject(job) || !isNonemptyString(jobId)) return null;
  if (Object.hasOwn(job, 'uses') || Object.hasOwn(job, 'continue-on-error')) return null;
  const declaredName = job.name ?? jobId;
  if (!isNonemptyString(declaredName)) return null;
  if (declaredName.length > MAX_JOB_NAME_LENGTH) return RESOURCE_LIMIT_EXCEEDED;

  const expanded = expandStaticMatrix({ name: declaredName, ...(Object.hasOwn(job, 'strategy') ? { strategy: job.strategy } : {}) }, {
    maxValues: MAX_MATRIX_VALUES, maxValueLength: MAX_MATRIX_VALUE_LENGTH,
    maxNameLength: MAX_JOB_NAME_LENGTH, maxExpandedNameLength: MAX_EXPANDED_NAME_LENGTH,
    maxExpandedChars: MAX_AUDIT_EXPANDED_CHARS,
  }, budget);
  if (expanded.error === 'resource-limit') return RESOURCE_LIMIT_EXCEEDED;
  if (expanded.error) return null;
  const { cells } = expanded;
  const checkNames = cells.map((cell) => cell.checkName);

  let needs = [];
  if (Object.hasOwn(job, 'needs')) {
    needs = Array.isArray(job.needs) ? job.needs : [job.needs];
    if (
      needs.length === 0 ||
      needs.some((item) => !isNonemptyString(item) || item.includes('${{')) ||
      new Set(needs).size !== needs.length
    ) {
      return null;
    }
  }

  let condition = null;
  if (Object.hasOwn(job, 'if')) {
    if (typeof job.if !== 'string' || job.if.trim() !== 'always()') return null;
    condition = 'always()';
  }

  return { workflowPath, jobId, checkNames, cells, needs, condition };
}

function validateDag(jobs) {
  const byId = new Map(jobs.map((job) => [job.jobId, job]));
  for (const job of jobs) {
    if (job.needs.some((dependency) => !byId.has(dependency))) return false;
  }
  const state = new Map();
  function visit(jobId) {
    if (state.get(jobId) === 'visiting') return false;
    if (state.get(jobId) === 'visited') return true;
    state.set(jobId, 'visiting');
    for (const dependency of byId.get(jobId).needs) {
      if (!visit(dependency)) return false;
    }
    state.set(jobId, 'visited');
    return true;
  }
  return jobs.every((job) => visit(job.jobId));
}

function patternMatch(pattern, subject) {
  if (pattern === '~DEFAULT_BRANCH') {
    if (!isNonemptyString(subject.defaultBranchRef)) return { supported: false, matches: false };
    return { supported: true, matches: subject.ref === subject.defaultBranchRef };
  }
  if (!BRANCH_REF.test(pattern)) return { supported: false, matches: false };
  return { supported: true, matches: pattern === subject.ref };
}

function normalizeCheckRequirement(check, source) {
  if (
    !isPlainObject(check) ||
    !isNonemptyString(check.context) ||
    !Object.hasOwn(check, 'integrationId') ||
    (check.integrationId !== null && !isProviderId(check.integrationId))
  ) {
    return null;
  }
  return { context: check.context, integrationId: check.integrationId, sources: [source] };
}

function activeGates(input) {
  const gates = [];
  for (const ruleset of input.controlPlane.rulesets) {
    if (
      !isPlainObject(ruleset) ||
      !['number', 'string'].includes(typeof ruleset.id) ||
      !isNonemptyString(String(ruleset.id)) ||
      !isNonemptyString(ruleset.target) ||
      !isNonemptyString(ruleset.enforcement) ||
      !Array.isArray(ruleset.requiredStatusChecks)
    ) {
      return { error: 'MALFORMED_RULESET_EVIDENCE' };
    }
    if (ruleset.enforcement !== 'active' || ruleset.target !== 'branch') continue;
    const refName = ruleset.conditions?.refName;
    if (
      !isPlainObject(refName) ||
      !Array.isArray(refName.include) ||
      refName.include.length === 0 ||
      !Array.isArray(refName.exclude) ||
      !refName.include.every(isNonemptyString) ||
      !refName.exclude.every(isNonemptyString)
    ) {
      return { error: 'RULESET_APPLICABILITY_UNRESOLVED' };
    }
    const included = refName.include.map((pattern) => patternMatch(pattern, input.subject));
    const excluded = refName.exclude.map((pattern) => patternMatch(pattern, input.subject));
    if ([...included, ...excluded].some((result) => !result.supported)) {
      return { error: 'RULESET_APPLICABILITY_UNRESOLVED' };
    }
    const applies = included.some((result) => result.matches) && !excluded.some((result) => result.matches);
    if (!applies) continue;
    for (const check of ruleset.requiredStatusChecks) {
      const gate = normalizeCheckRequirement(check, { kind: 'ruleset', id: String(ruleset.id) });
      if (!gate) return { error: 'MALFORMED_REQUIRED_CONTEXT' };
      gates.push(gate);
    }
  }

  const classic = input.controlPlane.classicProtection;
  if (classic.state === 'unknown') return { error: 'CLASSIC_PROTECTION_UNKNOWN' };
  if (
    classic.state !== 'observed' ||
    classic.targetRef !== input.subject.ref ||
    !Array.isArray(classic.requiredStatusChecks)
  ) {
    return { error: 'CLASSIC_PROTECTION_UNKNOWN' };
  }
  for (const check of classic.requiredStatusChecks) {
    const gate = normalizeCheckRequirement(check, { kind: 'classic-protection', ref: classic.targetRef });
    if (!gate) return { error: 'MALFORMED_REQUIRED_CONTEXT' };
    gates.push(gate);
  }

  const deduplicated = new Map();
  for (const gate of gates) {
    const key = `${gate.context}\0${gate.integrationId ?? '*'}`;
    const existing = deduplicated.get(key);
    if (existing) existing.sources.push(...gate.sources);
    else deduplicated.set(key, gate);
  }
  return { gates: [...deduplicated.values()] };
}

function validateRuns(input, workflows) {
  const byPath = new Map(workflows.map((workflow) => [workflow.path, workflow]));
  const runsByPath = new Map();
  const checkByName = new Map();
  const runIds = new Set();
  for (const run of input.observedRuns) {
    if (
      !isPlainObject(run) ||
      !isNonemptyString(run.runId) ||
      runIds.has(run.runId) ||
      run.sha !== input.subject.sha ||
      run.targetRef !== input.subject.ref ||
      !isNonemptyString(run.workflowPath) ||
      !byPath.has(run.workflowPath) ||
      !isNonemptyString(run.event) ||
      !byPath.get(run.workflowPath).triggers.has(run.event) ||
      run.status !== 'completed' ||
      !isNonemptyString(run.conclusion) ||
      !Array.isArray(run.checkRuns) ||
      run.checkRuns.length === 0
    ) {
      return null;
    }
    runIds.add(run.runId);
    if (runsByPath.has(run.workflowPath)) return null;
    runsByPath.set(run.workflowPath, run);
    for (const check of run.checkRuns) {
      if (
        !isPlainObject(check) ||
        !isNonemptyString(check.name) ||
        check.sha !== input.subject.sha ||
        check.status !== 'completed' ||
        !isNonemptyString(check.conclusion) ||
        !isPlainObject(check.provider) ||
        check.provider.kind !== 'github-app' ||
        !isProviderId(check.provider.integrationId) ||
        checkByName.has(check.name)
      ) {
        return null;
      }
      checkByName.set(check.name, { ...check, workflowPath: run.workflowPath, runId: run.runId });
    }
  }
  if (workflows.some((workflow) => !runsByPath.has(workflow.path))) return null;
  return { runsByPath, checkByName };
}

function normalizePolicy(input, workflows) {
  const workflowMap = new Map(workflows.map((workflow) => [workflow.path, workflow]));
  const policy = new Map();
  for (const item of input.policy.jobs) {
    if (
      !isPlainObject(item) ||
      !isNonemptyString(item.workflowPath) ||
      !isNonemptyString(item.jobId) ||
      !['voting', 'advisory'].includes(item.mergePolicy) ||
      !workflowMap.get(item.workflowPath)?.jobsById.has(item.jobId)
    ) {
      return null;
    }
    const key = `${item.workflowPath}\0${item.jobId}`;
    if (policy.has(key)) return null;
    policy.set(key, item.mergePolicy);
  }
  return policy;
}

function normalizeGatePolicies(input, resolvedGates) {
  const rawPolicies = input.policy.gates ?? {};
  if (!isPlainObject(rawPolicies)) return null;
  const activeGateIds = new Set(resolvedGates.map((resolved) => (
    `${resolved.workflow.path}/${resolved.job.jobId}`
  )));
  const policies = new Map();
  for (const [gateId, record] of Object.entries(rawPolicies)) {
    const normalized = normalizedGatePolicyRecord(record);
    if (!activeGateIds.has(gateId) || !normalized) return null;
    policies.set(gateId, normalized);
  }
  return policies;
}

function ancestorSet(jobId, jobsById, memo) {
  if (memo.has(jobId)) return memo.get(jobId);
  const ancestors = new Set();
  for (const dependency of jobsById.get(jobId).needs) {
    ancestors.add(dependency);
    for (const transitive of ancestorSet(dependency, jobsById, memo)) ancestors.add(transitive);
  }
  memo.set(jobId, ancestors);
  return ancestors;
}

function publicGate(gate) {
  return { context: gate.context, integrationId: gate.integrationId, sources: gate.sources };
}

function uncoveredResult({
  input,
  instance,
  workflow,
  policy,
  gates,
  resolvedGates,
  allRunIds,
  producerJobIdOverride,
}) {
  const identityKey = `${workflow.path}\0${instance.job.jobId}`;
  const mergePolicy = policy.get(identityKey);
  const producerJobId = producerJobIdOverride ?? (
    instance.job.checkNames.length > 1 ? instance.checkName : instance.job.jobId
  );
  const requiredContexts = [...new Set(gates.map((gate) => gate.context))];
  const evidenceCoordinates = {
    sha: input.subject.sha,
    ref: input.subject.ref,
    workflowPath: workflow.path,
    runIds: allRunIds,
  };
  const singleAggregate = resolvedGates.length === 1 && resolvedGates[0].job.needs.length > 0
    ? resolvedGates[0]
    : null;
  const common = {
    producerJobId,
    producerCheckName: instance.checkName,
    producer: {
      workflowPath: workflow.path,
      jobId: instance.job.jobId,
      checkName: instance.checkName,
      integrationId: instance.check.provider.integrationId,
    },
    requiredContexts,
    activeGates: gates.map(publicGate),
    evidenceCoordinates,
    unresolvedPremises: [],
    ...(singleAggregate ? {
      aggregateJobId: singleAggregate.job.jobId,
      requiredContext: singleAggregate.gate.context,
    } : {}),
  };
  if (mergePolicy === 'advisory') {
    return {
      status: 'unknown',
      reasonCode: 'EXPLICIT_ADVISORY',
      message: 'The uncovered producer is explicitly advisory under the supplied policy contract',
      ...common,
    };
  }
  if (mergePolicy !== 'voting') {
    return {
      status: 'policy-review',
      reasonCode: 'VOTING_INTENT_UNKNOWN',
      message: 'The producer is uncovered but no explicit voting policy was supplied',
      ...common,
      unresolvedPremises: ['VOTING_INTENT_NOT_SUPPLIED'],
    };
  }
  return {
    status: 'finding',
    kind: 'uncovered-failure-path',
    severity: 'error',
    evidenceState: 'VERIFIED',
    reasonCode: 'UNCOVERED_BY_ALL_ACTIVE_GATES',
    message: 'The voting producer can fail while every active required gate remains independent of it',
    ...common,
    ...(singleAggregate ? {
      failureScenario: `${producerJobId}=failure while every dependency of ${singleAggregate.job.jobId} succeeds`,
    } : {}),
  };
}

/**
 * Audit a bounded control-plane input for an uncovered voting-job failure path.
 *
 * @param {AuditInput} input
 * @returns {Promise<AuditReport>}
 */
export async function auditControlPlane(input) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('auditControlPlane input must be an object');
  }

  const canonicalError = validateCanonicalInput(input);
  if (canonicalError) {
    return collectionError(
      input,
      canonicalError.reasonCode,
      canonicalError.reasonCode === 'CLASSIC_PROTECTION_UNKNOWN'
        ? 'Classic branch protection could not be resolved'
        : 'Required evidence is incomplete or not anchored to one immutable coordinate',
      { unresolvedPremises: [canonicalError.premise] },
    );
  }

  const workflows = [];
  let workflowBytes = 0;
  for (const workflowInput of input.workflows) {
    if (workflowInput.text.length > MAX_WORKFLOW_BYTES) {
      return collectionError(input, 'WORKFLOW_RESOURCE_LIMIT_EXCEEDED', 'Workflow resource limit exceeded', {
        workflowPath: workflowInput.path,
        unresolvedPremises: ['WORKFLOW_RESOURCE_LIMIT_EXCEEDED'],
      });
    }
    const bytes = Buffer.byteLength(workflowInput.text, 'utf8');
    workflowBytes += bytes;
    if (bytes > MAX_WORKFLOW_BYTES || workflowBytes > MAX_AUDIT_WORKFLOW_BYTES) {
      return collectionError(input, 'WORKFLOW_RESOURCE_LIMIT_EXCEEDED', 'Workflow resource limit exceeded', {
        workflowPath: workflowInput.path,
        unresolvedPremises: ['WORKFLOW_RESOURCE_LIMIT_EXCEEDED'],
      });
    }
  }
  const budget = { expandedChars: 0 };
  for (const workflowInput of input.workflows) {
    let doc;
    try {
      doc = parseDocument(workflowInput.text);
    } catch {
      return collectionError(
        input,
        'WORKFLOW_PARSE_ERROR',
        'Workflow YAML could not be parsed',
        {
          workflowPath: workflowInput.path,
          unresolvedPremises: ['WORKFLOW_DOCUMENT_INVALID'],
        },
      );
    }
    if (doc.errors.length > 0) {
      const position = doc.errors[0]?.linePos?.[0];
      return collectionError(
        input,
        'WORKFLOW_PARSE_ERROR',
        'Workflow YAML could not be parsed',
        {
          workflowPath: workflowInput.path,
          ...(position ? { location: { line: position.line, column: position.col } } : {}),
          unresolvedPremises: ['WORKFLOW_DOCUMENT_INVALID'],
        },
      );
    }
    let value;
    try {
      value = doc.toJS();
    } catch {
      return collectionError(
        input,
        'WORKFLOW_PARSE_ERROR',
        'Workflow YAML could not be parsed',
        {
          workflowPath: workflowInput.path,
          unresolvedPremises: ['WORKFLOW_DOCUMENT_CONVERSION_FAILED'],
        },
      );
    }
    const triggers = triggerEvents(value);
    if (!isPlainObject(value) || !triggers || !isPlainObject(value.jobs) || Object.keys(value.jobs).length === 0) {
      return collectionError(
        input,
        'UNSUPPORTED_OR_AMBIGUOUS_EVIDENCE',
        'Workflow structure is outside the supported evidence subset',
        { workflowPath: workflowInput.path, unresolvedPremises: ['WORKFLOW_SHAPE_UNSUPPORTED'] },
      );
    }
    if (Object.keys(value.jobs).length > MAX_JOBS_PER_WORKFLOW) {
      return collectionError(input, 'WORKFLOW_RESOURCE_LIMIT_EXCEEDED', 'Workflow resource limit exceeded', {
        workflowPath: workflowInput.path,
        unresolvedPremises: ['WORKFLOW_RESOURCE_LIMIT_EXCEEDED'],
      });
    }
    const jobs = Object.entries(value.jobs).map(([jobId, job]) => normalizedJob(workflowInput.path, jobId, job, budget));
    if (jobs.includes(RESOURCE_LIMIT_EXCEEDED)) {
      return collectionError(input, 'WORKFLOW_RESOURCE_LIMIT_EXCEEDED', 'Workflow resource limit exceeded', {
        workflowPath: workflowInput.path,
        unresolvedPremises: ['WORKFLOW_RESOURCE_LIMIT_EXCEEDED'],
      });
    }
    if (jobs.includes(null) || !validateDag(jobs)) {
      return collectionError(
        input,
        'UNSUPPORTED_OR_AMBIGUOUS_EVIDENCE',
        'Workflow job semantics or dependency graph are outside the supported evidence subset',
        { workflowPath: workflowInput.path, unresolvedPremises: ['JOB_DAG_UNSUPPORTED'] },
      );
    }
    const checkNames = new Set();
    for (const job of jobs) {
      for (const checkName of job.checkNames) {
        if (checkNames.has(checkName)) {
          return collectionError(
            input,
            'UNSUPPORTED_OR_AMBIGUOUS_EVIDENCE',
            'Multiple job identities emit the same check name',
            { workflowPath: workflowInput.path, unresolvedPremises: ['DUPLICATE_CHECK_IDENTITY'] },
          );
        }
        checkNames.add(checkName);
      }
    }
    workflows.push({
      path: workflowInput.path,
      triggers,
      jobs,
      jobsById: new Map(jobs.map((job) => [job.jobId, job])),
    });
  }

  const gateResult = activeGates(input);
  if (gateResult.error === 'CLASSIC_PROTECTION_UNKNOWN') {
    return collectionError(
      input,
      'CLASSIC_PROTECTION_UNKNOWN',
      'Classic branch protection could not be resolved',
      { unresolvedPremises: ['CLASSIC_PROTECTION_NOT_OBSERVED'] },
    );
  }
  if (gateResult.error) {
    return collectionError(
      input,
      'UNSUPPORTED_OR_AMBIGUOUS_EVIDENCE',
      'Active required-check applicability is incomplete or malformed',
      { unresolvedPremises: [gateResult.error] },
    );
  }
  const gates = gateResult.gates;
  if (gates.length === 0) {
    return collectionError(
      input,
      'NO_ACTIVE_REQUIRED_GATE',
      'No active applicable required gate was proven',
      { unresolvedPremises: ['ACTIVE_GATE_NOT_PROVEN'] },
    );
  }

  const runEvidence = validateRuns(input, workflows);
  if (!runEvidence) {
    return collectionError(
      input,
      'UNSUPPORTED_OR_AMBIGUOUS_EVIDENCE',
      'Workflow-run lifecycle, identity, or coordinate evidence is ambiguous',
      { unresolvedPremises: ['RUN_OR_CHECK_IDENTITY_UNRESOLVED'] },
    );
  }

  const workflowByPath = new Map(workflows.map((workflow) => [workflow.path, workflow]));
  const jobInstances = [];
  const instancesByCheckName = new Map();
  for (const workflow of workflows) {
    for (const job of workflow.jobs) {
      for (const { checkName, axes } of job.cells) {
        const observed = runEvidence.checkByName.get(checkName);
        if (!observed || observed.workflowPath !== workflow.path || instancesByCheckName.has(checkName)) {
          return collectionError(
            input,
            'UNSUPPORTED_OR_AMBIGUOUS_EVIDENCE',
            'Workflow jobs and observed check identities do not join uniquely',
            { workflowPath: workflow.path, unresolvedPremises: ['JOB_CHECK_JOIN_UNRESOLVED'] },
          );
        }
        const instance = { workflow, job, checkName, axes, check: observed };
        jobInstances.push(instance);
        instancesByCheckName.set(checkName, instance);
      }
    }
  }

  const resolvedGates = [];
  for (const gate of gates) {
    const observed = runEvidence.checkByName.get(gate.context);
    const instance = instancesByCheckName.get(gate.context);
    if (
      !observed ||
      !instance ||
      (gate.integrationId !== null && observed.provider.integrationId !== gate.integrationId)
    ) {
      return collectionError(
        input,
        'UNSUPPORTED_OR_AMBIGUOUS_EVIDENCE',
        'An active required context could not be joined to one provider-qualified workflow job',
        { unresolvedPremises: ['REQUIRED_CONTEXT_IDENTITY_UNRESOLVED'] },
      );
    }
    resolvedGates.push({ gate, ...instance });
  }

  const gatePolicies = normalizeGatePolicies(input, resolvedGates);
  if (!gatePolicies) {
    return collectionError(
      input,
      'UNSUPPORTED_OR_AMBIGUOUS_EVIDENCE',
      'Gate policy identities or failure-propagation evidence are unsupported',
      { unresolvedPremises: ['GATE_POLICY_UNSUPPORTED'] },
    );
  }

  const gateJobs = new Set(resolvedGates.map((item) => `${item.workflow.path}\0${item.job.jobId}`));
  for (const workflow of workflows) {
    for (const job of workflow.jobs) {
      const gatePolicyId = `${workflow.path}/${job.jobId}`;
      if (
        job.condition !== null &&
        (
          !gateJobs.has(`${workflow.path}\0${job.jobId}`) ||
          job.needs.length === 0 ||
          job.checkNames.length !== 1 ||
          !gatePolicies.has(gatePolicyId)
        )
      ) {
        return collectionError(
          input,
          'UNSUPPORTED_OR_AMBIGUOUS_EVIDENCE',
          'Conditional job propagation is outside the supported evidence subset',
          { workflowPath: workflow.path, unresolvedPremises: ['CONDITIONAL_PROPAGATION_UNSUPPORTED'] },
        );
      }
    }
  }

  for (const resolved of resolvedGates) {
    const gatePolicyId = `${resolved.workflow.path}/${resolved.job.jobId}`;
    if (
      resolved.job.needs.length > 0 &&
      (resolved.job.checkNames.length !== 1 || !gatePolicies.has(gatePolicyId))
    ) {
      return collectionError(
        input,
        'UNSUPPORTED_OR_AMBIGUOUS_EVIDENCE',
        'Required aggregate failure propagation was not explicitly proven',
        { workflowPath: resolved.workflow.path, unresolvedPremises: ['GATE_PROPAGATION_NOT_PROVEN'] },
      );
    }
    if (resolved.job.needs.length === 0 && gatePolicies.has(gatePolicyId)) {
      return collectionError(
        input,
        'UNSUPPORTED_OR_AMBIGUOUS_EVIDENCE',
        'Gate policy identities or failure-propagation evidence are unsupported',
        { workflowPath: resolved.workflow.path, unresolvedPremises: ['GATE_POLICY_UNSUPPORTED'] },
      );
    }
  }

  const policy = normalizePolicy(input, workflows);
  if (!policy) {
    return collectionError(
      input,
      'UNSUPPORTED_OR_AMBIGUOUS_EVIDENCE',
      'Policy job identities are ambiguous or outside the analyzed workflows',
      { unresolvedPremises: ['POLICY_IDENTITY_UNRESOLVED'] },
    );
  }

  const ancestorMemoByWorkflow = new Map();
  for (const workflow of workflows) ancestorMemoByWorkflow.set(workflow.path, new Map());
  const gateCoverage = resolvedGates.map((resolved) => ({
    ...resolved,
    ancestors: gatePolicies.has(`${resolved.workflow.path}/${resolved.job.jobId}`)
      ? ancestorSet(
        resolved.job.jobId,
        workflowByPath.get(resolved.workflow.path).jobsById,
        ancestorMemoByWorkflow.get(resolved.workflow.path),
      )
      : new Set(),
  }));
  const allRunIds = [...new Set(input.observedRuns.map((run) => run.runId))];
  const results = [];
  const instancesByJob = new Map();
  for (const instance of jobInstances) {
    const key = `${instance.workflow.path}\0${instance.job.jobId}`;
    if (!instancesByJob.has(key)) instancesByJob.set(key, []);
    instancesByJob.get(key).push(instance);
  }
  for (const instances of instancesByJob.values()) {
    const [{ workflow, job }] = instances;
    const transitivelyCovered = gateCoverage.some((gate) => (
      gate.workflow.path === workflow.path && gate.ancestors.has(job.jobId)
    ));
    if (transitivelyCovered) continue;
    const uncoveredInstances = instances.filter((instance) => !resolvedGates.some((gate) => (
      gate.workflow.path === workflow.path &&
      gate.job.jobId === job.jobId &&
      gate.checkName === instance.checkName
    )));
    if (uncoveredInstances.length === 0) continue;
    const wholeJobIsUncovered = uncoveredInstances.length === instances.length;
    const instancesToReport = wholeJobIsUncovered ? [uncoveredInstances[0]] : uncoveredInstances;
    for (const instance of instancesToReport) {
      results.push(uncoveredResult({
        input,
        instance,
        workflow,
        policy,
        gates,
        resolvedGates,
        allRunIds,
        producerJobIdOverride: wholeJobIsUncovered ? job.jobId : undefined,
      }));
    }
  }

  const precedence = ['finding', 'policy-review', 'unknown'];
  const status = precedence.find((candidate) => results.some((result) => result.status === candidate)) ?? 'unknown';
  return {
    version: 1,
    status,
    subject: safeSubject(input),
    results: results.length > 0 ? results : [{
      status: 'unknown',
      reasonCode: 'NO_UNCOVERED_PATH_PROVEN',
      message: 'No uncovered voting path was proven for the bounded input',
      activeGates: gates.map(publicGate),
      unresolvedPremises: [],
    }],
    provenance: provenance(input, gatePolicies),
  };
}
