import { open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseDocument } from 'yaml';

const CONTRACT = 'gategraph-authored-policy/v1';
const MAX_POLICY_BYTES = 64 * 1024;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA = /^[0-9a-f]{40}$/i;
const REF = /^refs\/heads\/[A-Za-z0-9._\-/]+$/;
const JOB_ID = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const EVIDENCE = /^[A-Za-z0-9][A-Za-z0-9._:\/@-]{0,255}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const fingerprint = (text) => createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 12);
const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;
const runId = (value) => typeof value === 'string' && /^[1-9][0-9]*$/.test(value) && positiveInteger(Number(value));
const stringMatches = (value, pattern) => typeof value === 'string' && pattern.test(value);
const workflowPath = (value) => typeof value === 'string' && /^\.github\/workflows\/.+\.ya?ml$/.test(value) &&
  !value.includes('\\') && value.split('/').every((part) => part && part !== '.' && part !== '..');

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function exactKeys(value, keys) {
  return record(value) && Reflect.ownKeys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function canonicalTime(value) {
  return stringMatches(value, UTC) && Number.isFinite(Date.parse(value)) && Date.parse(value) > 0 &&
    new Date(value).toISOString() === value;
}

function safeTree(root) {
  const pending = [root];
  const seen = new WeakSet();
  while (pending.length) {
    const value = pending.pop();
    if (value === null || typeof value !== 'object') continue;
    if (seen.has(value)) return false;
    seen.add(value);
    if (Array.isArray(value)) {
      if (Reflect.ownKeys(value).length !== value.length + 1) return false;
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) return false;
        pending.push(descriptor.value);
      }
    } else {
      if (!record(value)) return false;
      for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== 'string' || FORBIDDEN_KEYS.has(key)) return false;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!Object.hasOwn(descriptor, 'value')) return false;
        pending.push(descriptor.value);
      }
    }
  }
  return true;
}

/** Validate only supplied data; this does not authenticate the author's assertion. */
export function validateAuthoredPolicy(document) {
  try {
    if (!safeTree(document) || !exactKeys(document, ['contract', 'coordinate', 'review', 'jobs', 'gates']) ||
      document.contract !== CONTRACT) return false;
    const { coordinate, review, jobs, gates } = document;
    if (!exactKeys(coordinate, ['repository', 'sha', 'targetRef', 'runs']) ||
      !stringMatches(coordinate.repository, REPOSITORY) || !stringMatches(coordinate.sha, SHA) ||
      !stringMatches(coordinate.targetRef, REF) || !Array.isArray(coordinate.runs) || !coordinate.runs.length ||
      !coordinate.runs.every((run) => exactKeys(run, ['runId', 'workflowPath', 'runAttempt']) &&
        runId(run.runId) && workflowPath(run.workflowPath) && positiveInteger(run.runAttempt)) ||
      new Set(coordinate.runs.map((run) => run.runId)).size !== coordinate.runs.length ||
      new Set(coordinate.runs.map((run) => run.workflowPath)).size !== coordinate.runs.length) return false;
    if (!exactKeys(review, ['observedAt', 'evidence']) || !canonicalTime(review.observedAt) ||
      !stringMatches(review.evidence, EVIDENCE) || !Array.isArray(jobs) ||
      !jobs.every((job) => exactKeys(job, ['workflowPath', 'jobId', 'mergePolicy']) &&
        workflowPath(job.workflowPath) && stringMatches(job.jobId, JOB_ID) && ['voting', 'advisory'].includes(job.mergePolicy)) ||
      new Set(jobs.map((job) => `${job.workflowPath}\0${job.jobId}`)).size !== jobs.length || !record(gates)) return false;
    return Object.entries(gates).every(([key, gate]) => {
      const separator = key.lastIndexOf('/');
      return workflowPath(key.slice(0, separator)) && stringMatches(key.slice(separator + 1), JOB_ID) &&
        exactKeys(gate, ['failurePropagation', 'evidence']) && gate.failurePropagation === 'all-needs' &&
        stringMatches(gate.evidence, EVIDENCE);
    });
  } catch {
    return false;
  }
}

async function readBoundedText(path, openImpl) {
  const file = await openImpl(path, 'r');
  try {
    if (!(await file.stat()).isFile()) throw new TypeError('not a regular policy file');
    const buffer = Buffer.alloc(MAX_POLICY_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length === 0 || length > MAX_POLICY_BYTES) throw new TypeError('invalid policy size');
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, length));
  } finally {
    await file.close();
  }
}

/** Read bounded strict JSON; never expose file, parser, or raw evidence details. */
export async function readAuthoredPolicy(path, { openImpl = open } = {}) {
  try {
    const text = await readBoundedText(path, openImpl);
    const document = JSON.parse(text);
    if (!validateAuthoredPolicy(document)) return null;
    const parsed = parseDocument(text, { schema: 'json', uniqueKeys: true, prettyErrors: false, logLevel: 'silent' });
    return parsed.errors.length === 0 ? document : null;
  } catch {
    return null;
  }
}

export function policyMatchesRequest(document, coordinate) {
  return validateAuthoredPolicy(document) && document.coordinate.repository === coordinate.repository &&
    document.coordinate.sha === coordinate.sha && document.coordinate.targetRef === coordinate.targetRef &&
    Array.isArray(coordinate.runIds) && document.coordinate.runs.length === coordinate.runIds.length &&
    document.coordinate.runs.every((run) => coordinate.runIds.includes(run.runId));
}

function appendFailure(next, reasonCode) {
  next.collection = { ...next.collection, complete: false, sources: [
    ...(Array.isArray(next.collection?.sources) ? next.collection.sources : []),
    { name: 'policy', outcome: 'failed', complete: false, reasonCode },
  ] };
  return next;
}

export function createPolicyErrorInput({ repository, sha, targetRef }, reasonCode) {
  return appendFailure({
    analysis: { analyzer: 'gategraph-ci', version: '0.2.0-experimental.2', contract: 'gategraph-audit/v1', analyzedAt: new Date().toISOString() },
    subject: { kind: 'github', id: `${repository}@${sha}`, repository, sha, ref: targetRef },
    workflows: [], observedRuns: [], controlPlane: { rulesets: [], classicProtection: { state: 'unknown' } },
    policy: { jobs: [] }, collection: { complete: false, sources: [] },
  }, reasonCode);
}

function normalizedDocument(document) {
  const { coordinate, review } = document;
  return {
    contract: CONTRACT,
    coordinate: { repository: coordinate.repository, sha: coordinate.sha, targetRef: coordinate.targetRef,
      runs: coordinate.runs.map((run) => ({ runId: run.runId, workflowPath: run.workflowPath, runAttempt: run.runAttempt }))
        .sort((left, right) => left.runId < right.runId ? -1 : left.runId > right.runId ? 1 : 0) },
    review: { observedAt: review.observedAt, evidence: review.evidence },
    jobs: document.jobs.map((job) => ({ workflowPath: job.workflowPath, jobId: job.jobId, mergePolicy: job.mergePolicy }))
      .sort((left, right) => {
        const a = `${left.workflowPath}\0${left.jobId}`;
        const b = `${right.workflowPath}\0${right.jobId}`;
        return a < b ? -1 : a > b ? 1 : 0;
      }),
    gates: Object.fromEntries(Object.keys(document.gates).sort().map((key) => [key,
      { failurePropagation: 'all-needs', evidence: document.gates[key].evidence }])),
  };
}

/** Clone and bind authored policy without healing any prior collection failure. */
export function applyAuthoredPolicy(input, document) {
  const next = structuredClone(input);
  if (!validateAuthoredPolicy(document)) return appendFailure(next, 'POLICY_INPUT_INVALID');
  const requested = { repository: input.subject?.repository, sha: input.subject?.sha,
    targetRef: input.subject?.ref, runIds: input.collection?.scope?.runIds };
  if (input.subject?.kind !== 'github' || !policyMatchesRequest(document, requested) ||
    !Array.isArray(input.observedRuns) || input.observedRuns.length !== document.coordinate.runs.length ||
    !document.coordinate.runs.every((run) => input.observedRuns.filter((observed) =>
      observed.runId === run.runId && observed.workflowPath === run.workflowPath && observed.runAttempt === run.runAttempt).length === 1)) {
    return appendFailure(next, 'POLICY_COORDINATE_MISMATCH');
  }
  if (!canonicalTime(input.analysis?.analyzedAt) || Date.parse(document.review.observedAt) > Date.parse(input.analysis.analyzedAt)) {
    return appendFailure(next, 'POLICY_INPUT_INVALID');
  }
  const normalized = normalizedDocument(document);
  next.policy = { jobs: structuredClone(document.jobs), gates: structuredClone(document.gates) };
  next.collection.sources = next.collection.sources.filter((source) => !(
    exactKeys(source, ['name', 'outcome', 'complete']) &&
    source.name === 'policy' && source.outcome === 'not-supplied' && source.complete === true
  ));
  next.collection.sources.push({ name: 'policy', outcome: 'observed', complete: true, sha: input.subject.sha, ref: input.subject.ref });
  next.collection.policyInput = { contract: CONTRACT, coordinate: normalized.coordinate,
    reviewedAt: normalized.review.observedAt, evidenceFingerprint: fingerprint(normalized.review.evidence),
    documentFingerprint: fingerprint(JSON.stringify(normalized)) };
  return next;
}
