import assert from 'node:assert/strict';
import test from 'node:test';
import { createDemoInput } from '../src/demo-evidence.mjs';
import { auditControlPlane } from '../src/audit-control-plane.mjs';
import { validateAuthoredPolicy, applyAuthoredPolicy, readAuthoredPolicy } from '../src/policy-input.mjs';
import { runCli } from '../bin/gategraph.mjs';
import { collectWithGh } from '../src/gh-adapter.mjs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const repository = 'example/project';
const sha = '0123456789abcdef0123456789abcdef01234567';
const targetRef = 'refs/heads/main';
const workflowPath = '.github/workflows/ci.yml';

function evidence() {
  const input = createDemoInput('finding');
  input.analysis.analyzedAt = '2026-09-05T06:01:00.000Z';
  input.subject = { kind: 'github', id: `${repository}@${sha}`, repository, sha, ref: targetRef, defaultBranchRef: targetRef };
  Object.assign(input.workflows[0], { path: workflowPath, sha });
  Object.assign(input.observedRuns[0], { runId: '501', workflowPath, runAttempt: 2, sha });
  for (const check of input.observedRuns[0].checkRuns) check.sha = sha;
  input.collection.scope = { kind: 'selected-runs', repository, sha, targetRef,
    runIds: ['501'], excludedRunIds: [], excludedWorkflowPaths: [] };
  for (const source of input.collection.sources) {
    if (Object.hasOwn(source, 'sha')) source.sha = sha;
    if (Object.hasOwn(source, 'path')) source.path = workflowPath;
    if (Object.hasOwn(source, 'runId')) source.runId = '501';
    if (source.name === 'policy') source.outcome = 'not-supplied';
  }
  input.policy = { jobs: [] };
  return input;
}

function policy() {
  return {
    contract: 'gategraph-authored-policy/v1',
    coordinate: { repository, sha, targetRef, runs: [{ runId: '501', workflowPath, runAttempt: 2 }] },
    review: { observedAt: '2026-09-05T06:00:00.000Z', evidence: 'operator-reviewed-gate-behavior-v1' },
    jobs: ['producer', 'dependency'].map((jobId) => ({ workflowPath, jobId, mergePolicy: 'voting' })),
    gates: { [`${workflowPath}/gate`]: { failurePropagation: 'all-needs', evidence: 'operator-reviewed-gate-failure-propagation-v1' } },
  };
}

test('reviewed policy applies immutably and reports fingerprints through the real core', async () => {
  const input = evidence();
  const original = structuredClone(input);
  const document = policy();
  assert.equal(validateAuthoredPolicy(document), true);
  const applied = applyAuthoredPolicy(input, document);
  assert.deepEqual(input, original);
  assert.notEqual(applied, input);
  assert.deepEqual(applied.policy, { jobs: document.jobs, gates: document.gates });
  const report = await auditControlPlane(applied);
  assert.equal(report.status, 'finding', JSON.stringify(report.results));
  assert.match(report.provenance.policyInput.evidenceFingerprint, /^[0-9a-f]{12}$/);
  assert.match(report.provenance.policyInput.documentFingerprint, /^[0-9a-f]{12}$/);
  assert.equal(JSON.stringify(report).includes(document.review.evidence), false);
  assert.equal(JSON.stringify(report).includes(document.gates[`${workflowPath}/gate`].evidence), false);
});

for (const [name, mutate] of [
  ['repository', (document) => { document.coordinate.repository = 'other/project'; }],
  ['SHA', (document) => { document.coordinate.sha = 'f'.repeat(40); }],
  ['target', (document) => { document.coordinate.targetRef = 'refs/heads/release'; }],
  ['run ID', (document) => { document.coordinate.runs[0].runId = '502'; }],
  ['workflow', (document) => { document.coordinate.runs[0].workflowPath = '.github/workflows/other.yml'; }],
  ['attempt', (document) => { document.coordinate.runs[0].runAttempt = 1; }],
]) {
  test(`policy ${name} mismatch fails closed`, async () => {
    const document = policy();
    mutate(document);
    const report = await auditControlPlane(applyAuthoredPolicy(evidence(), document));
    assert.equal(report.status, 'collection-error');
    assert.equal(report.results[0].reasonCode, 'POLICY_COORDINATE_MISMATCH');
  });
}

for (const outcome of ['failed', 'unknown', 'incomplete']) {
  test(`applying policy retains a prior ${outcome} policy source and incomplete collection`, async () => {
    const input = evidence();
    const failed = { name: 'policy', outcome, complete: false, reasonCode: 'GH_COLLECTION_FAILED' };
    input.collection.sources.push(failed);
    input.collection.complete = false;
    const applied = applyAuthoredPolicy(input, policy());
    assert.equal(applied.collection.complete, false);
    assert.ok(applied.collection.sources.some((source) => source.outcome === outcome && source.complete === false));
    const report = await auditControlPlane(applied);
    assert.equal(report.status, 'collection-error');
    assert.equal(report.results[0].reasonCode, 'GH_COLLECTION_FAILED');
  });
}

for (const [name, fields, premise] of [
  ['SHA', { sha: 'f'.repeat(40) }, 'SOURCE_COORDINATE_MISMATCH'],
  ['ref', { ref: 'refs/heads/release' }, 'SOURCE_COORDINATE_MISMATCH'],
  ['default branch', { defaultBranchRef: 'refs/heads/release' }, 'SOURCE_COORDINATE_MISMATCH'],
  ['endpoint', { endpoint: '' }, 'SOURCE_OUTCOME_INCOMPLETE'],
  ['pagination completeness', { pagesComplete: false }, 'SOURCE_OUTCOME_INCOMPLETE'],
  ['source completeness', { complete: false }, 'SOURCE_OUTCOME_INCOMPLETE'],
]) {
  test(`applying policy preserves a not-supplied source with invalid ${name}`, async () => {
    const input = evidence();
    const source = input.collection.sources.find((entry) => entry.name === 'policy');
    Object.assign(source, fields);
    const original = structuredClone(input);
    const before = await auditControlPlane(input);
    assert.equal(before.status, 'collection-error');
    assert.equal(before.results[0].reasonCode, 'EVIDENCE_INCOMPLETE');
    assert.deepEqual(before.results[0].unresolvedPremises, [premise]);
    const applied = applyAuthoredPolicy(input, policy());
    const after = await auditControlPlane(applied);
    assert.equal(after.status, 'collection-error');
    assert.equal(after.results[0].reasonCode, 'EVIDENCE_INCOMPLETE');
    assert.deepEqual(after.results[0].unresolvedPremises, [premise]);
    assert.deepEqual(applied.collection.sources.find((entry) => entry.outcome === 'not-supplied'), source);
    assert.deepEqual(input, original);
  });
}

test('unreadable policy input returns a safe invalid value', async () => {
  const document = await readAuthoredPolicy('not-present-policy-file.json', {
    openImpl: async () => { throw new Error('PRIVATE_PATH_CANARY'); },
  });
  assert.equal(document, null);
});

for (const [name, mutate] of [
  ['top-level extra key', (value) => { value.extra = 'POLICY_EXTRA_CANARY'; }],
  ['contract', (value) => { value.contract = 'unsupported'; }],
  ['coordinate extra key', (value) => { value.coordinate.extra = true; }],
  ['invalid SHA', (value) => { value.coordinate.sha = 'not-a-sha'; }],
  ['short target ref', (value) => { value.coordinate.targetRef = 'main'; }],
  ['zero run ID', (value) => { value.coordinate.runs[0].runId = '0'; }],
  ['unsafe attempt', (value) => { value.coordinate.runs[0].runAttempt = Number.MAX_SAFE_INTEGER + 1; }],
  ['duplicate runs', (value) => { value.coordinate.runs.push(structuredClone(value.coordinate.runs[0])); }],
  ['duplicate jobs', (value) => { value.jobs.push(structuredClone(value.jobs[0])); }],
  ['review extra key', (value) => { value.review.extra = true; }],
  ['noncanonical timestamp', (value) => { value.review.observedAt = '2026-09-05'; }],
  ['epoch timestamp', (value) => { value.review.observedAt = '1970-01-01T00:00:00.000Z'; }],
  ['invalid job ID', (value) => { value.jobs[0].jobId = '../producer'; }],
  ['invalid job policy', (value) => { value.jobs[0].mergePolicy = 'inferred'; }],
  ['unsupported propagation', (value) => { value.gates[`${workflowPath}/gate`].failurePropagation = 'native-needs'; }],
  ['extra gate field', (value) => { value.gates[`${workflowPath}/gate`].extra = true; }],
  ['parent path', (value) => { value.jobs[0].workflowPath = '.github/workflows/../other.yml'; }],
  ['empty evidence', (value) => { value.review.evidence = ''; }],
  ['sparse job list', (value) => { value.jobs = new Array(1); }],
  ['custom prototype', (value) => { Object.setPrototypeOf(value.review, { inherited: true }); }],
]) {
  test(`strict policy schema rejects ${name}`, () => {
    const document = policy();
    mutate(document);
    assert.equal(validateAuthoredPolicy(document), false);
  });
}

for (const key of ['__proto__', 'constructor', 'prototype']) {
  test(`recursive policy validation rejects own ${key} keys`, () => {
    const document = policy();
    Object.defineProperty(document.jobs[0], key, { value: {}, enumerable: true });
    assert.equal(validateAuthoredPolicy(document), false);
  });
}

test('future review evidence is invalid without inventing an age limit', async () => {
  const future = policy();
  future.review.observedAt = '2026-09-05T06:02:00.000Z';
  assert.equal((await auditControlPlane(applyAuthoredPolicy(evidence(), future))).status, 'collection-error');
  const old = policy();
  old.review.observedAt = '2000-01-01T00:00:00.000Z';
  assert.equal((await auditControlPlane(applyAuthoredPolicy(evidence(), old))).status, 'finding');
});

test('gate-only policy leaves voting intent unknown and voting-only policy cannot prove propagation', async () => {
  const gatesOnly = policy();
  gatesOnly.jobs = [];
  assert.equal((await auditControlPlane(applyAuthoredPolicy(evidence(), gatesOnly))).status, 'policy-review');
  const votingOnly = policy();
  votingOnly.gates = {};
  assert.equal((await auditControlPlane(applyAuthoredPolicy(evidence(), votingOnly))).status, 'collection-error');
});

test('raw evidence canaries are fingerprinted and document ordering is stable', async () => {
  const marker = 'gh' + 'p_' + 'A'.repeat(40);
  const document = policy();
  document.review.evidence = marker;
  document.gates[`${workflowPath}/gate`].evidence = marker;
  const input = evidence();
  const report = await auditControlPlane(applyAuthoredPolicy(input, document));
  assert.equal(report.status, 'finding');
  assert.equal(JSON.stringify(report).includes(marker), false);
  const reordered = { gates: document.gates, jobs: [...document.jobs].reverse(), review: document.review,
    coordinate: document.coordinate, contract: document.contract };
  const second = await auditControlPlane(applyAuthoredPolicy(input, reordered));
  assert.equal(second.provenance.policyInput.documentFingerprint, report.provenance.policyInput.documentFingerprint);
});

function boundedReader(text, chunkSize = 1024) {
  const bytes = Buffer.from(text, 'utf8');
  const observed = { copied: 0, closed: 0, capacities: [] };
  return { observed, openImpl: async () => ({
    stat: async () => ({ isFile: () => true }),
    read: async (buffer, offset, length) => {
      observed.capacities.push(buffer.byteLength);
      const count = Math.min(length, chunkSize, bytes.length - observed.copied);
      buffer.set(bytes.subarray(observed.copied, observed.copied + count), offset);
      observed.copied += count;
      return { bytesRead: count };
    },
    close: async () => { observed.closed += 1; },
  }) };
}

test('policy reading honors partial reads, exact 64 KiB, one overflow byte, and closing', async () => {
  const text = JSON.stringify(policy()).padEnd(64 * 1024, ' ');
  const exact = boundedReader(text);
  assert.deepEqual(await readAuthoredPolicy('synthetic.json', exact), policy());
  assert.equal(exact.observed.copied, 64 * 1024);
  assert.equal(exact.observed.closed, 1);
  assert.ok(exact.observed.capacities.every((size) => size === 64 * 1024 + 1));
  const oversized = boundedReader(text + ' '.repeat(10000));
  assert.equal(await readAuthoredPolicy('synthetic.json', oversized), null);
  assert.equal(oversized.observed.copied, 64 * 1024 + 1);
  assert.equal(oversized.observed.closed, 1);
});

for (const [name, createText] of [
  ['empty', () => ''],
  ['malformed JSON', () => '{'],
  ['non-JSON YAML', () => 'contract: gategraph-authored-policy/v1'],
  ['duplicate top-level key', (text) => text.replace('"contract":', '"contract":"gategraph-authored-policy/v1","contract":')],
  ['escape-equivalent nested key', (text) => text.replace('"repository":', '"repo\\u0073itory":"example/project","repository":')],
  ['duplicate array-member key', (text) => text.replace('"runAttempt":2', '"runAttempt":2,"runAttempt":2')],
  ['duplicate job key', (text) => text.replace('"jobId":"producer"', '"jobId":"producer","jobId":"producer"')],
  ['duplicate gate key', (text) => text.replace('"failurePropagation":', '"failurePropagation":"all-needs","failurePropagation":')],
  ['deep malformed shape', () => '['.repeat(3000) + '0' + ']'.repeat(3000)],
]) {
  test(`policy reader rejects ${name} without parser details`, async () => {
    const text = createText(JSON.stringify(policy()));
    if (name === 'escape-equivalent nested key') assert.ok(text.includes('\\u0073'));
    const reader = boundedReader(text);
    assert.equal(await readAuthoredPolicy('synthetic.json', reader), null);
    assert.equal(reader.observed.closed, 1);
  });
}

test('policy provenance tampering cannot be reflected by the core', async () => {
  const input = applyAuthoredPolicy(evidence(), policy());
  input.collection.policyInput.extra = 'POLICY_PROVENANCE_CANARY';
  const report = await auditControlPlane(input);
  assert.equal(report.status, 'collection-error');
  assert.equal(Object.hasOwn(report.provenance, 'policyInput'), false);
  assert.equal(JSON.stringify(report).includes('POLICY_PROVENANCE_CANARY'), false);
});

for (const [name, subjectKey, coordinateKey, value] of [
  ['invalid repository', 'repository', 'repository', 'INVALID_POLICY_REPOSITORY_CANARY'],
  ['repository array', 'repository', 'repository', [repository]],
  ['SHA array', 'sha', 'sha', [sha]],
  ['ref array', 'ref', 'targetRef', [targetRef]],
]) {
  test(`combined policy and subject ${name} cannot emit validated provenance`, async () => {
    const input = applyAuthoredPolicy(evidence(), policy());
    input.subject[subjectKey] = value;
    input.collection.scope[coordinateKey] = value;
    input.collection.policyInput.coordinate[coordinateKey] = value;
    const report = await auditControlPlane(input);
    assert.equal(report.status, 'collection-error');
    assert.equal(report.results[0].reasonCode, 'EVIDENCE_INCOMPLETE');
    assert.deepEqual(report.results[0].unresolvedPremises, ['INVALID_SUBJECT_COORDINATE']);
    assert.equal(Object.hasOwn(report.provenance, 'scope'), false);
    assert.equal(Object.hasOwn(report.provenance, 'policyInput'), false);
  });
}

test('policy metadata workflow arrays cannot pass through observed-value equality', async () => {
  const input = applyAuthoredPolicy(evidence(), policy());
  const invalid = [workflowPath];
  input.observedRuns[0].workflowPath = invalid;
  input.collection.policyInput.coordinate.runs[0].workflowPath = invalid;
  const report = await auditControlPlane(input);
  assert.equal(report.status, 'collection-error');
  assert.equal(Object.hasOwn(report.provenance, 'policyInput'), false);
});

test('an option-looking policy filename is a usage error before dependencies', async () => {
  let calls = 0;
  const result = await runCli(['audit', '--repo', repository, '--sha', sha, '--run-id', '501',
    '--target-ref', targetRef, '--policy-file', '--POLICY_OPTION_CANARY'], {
    collectWithGh: async () => { calls += 1; return {}; },
    auditControlPlane: async () => { calls += 1; return { status: 'collection-error' }; },
    stdout: { write() {} }, stderr: { write() {} },
  });
  assert.equal(result, 1);
  assert.equal(calls, 0);
});

test('a policy flag without explicit target and run IDs is a usage error before file or network access', async () => {
  let errors = '';
  const exit = await runCli(['audit', '--repo', repository, '--sha', sha, '--policy-file', 'POLICY_PATH_CANARY'], {
    collectWithGh: async () => { assert.fail('collector invoked'); },
    auditControlPlane: async () => { assert.fail('core invoked'); },
    stdout: { write() { assert.fail('unexpected stdout'); } }, stderr: { write(text) { errors += text; } },
  });
  assert.equal(exit, 1);
  assert.equal(errors.includes('POLICY_PATH_CANARY'), false);
});

async function invokePolicyFile(text, collector) {
  const directory = await mkdtemp(join(tmpdir(), 'gategraph-policy-test-'));
  const path = join(directory, 'reviewed policy.json');
  await writeFile(path, text, 'utf8');
  let stdout = '';
  let stderr = '';
  const code = await runCli(['audit', '--repo', repository, '--sha', sha, '--run-id', '501',
    '--target-ref', targetRef, '--policy-file', path], {
    collectWithGh: collector,
    stdout: { write(value) { stdout += value; } }, stderr: { write(value) { stderr += value; } },
  });
  assert.equal(stderr, '');
  assert.equal(stdout.includes(path), false);
  assert.equal(stdout.includes(directory), false);
  return { code, report: JSON.parse(stdout) };
}

for (const [name, createText, reason] of [
  ['malformed JSON', () => '{', 'POLICY_INPUT_INVALID'],
  ['oversized input', () => JSON.stringify(policy()).padEnd(64 * 1024 + 1, ' '), 'POLICY_INPUT_INVALID'],
  ['coordinate mismatch', () => { const document = policy(); document.coordinate.sha = 'f'.repeat(40);
    return JSON.stringify(document); }, 'POLICY_COORDINATE_MISMATCH'],
]) {
  test(`CLI rejects ${name} before live collection using a real local policy file`, async () => {
    let calls = 0;
    const result = await invokePolicyFile(createText(), async () => { calls += 1; assert.fail('live collector invoked'); });
    assert.equal(calls, 0);
    assert.equal(result.code, 4);
    assert.equal(result.report.results[0].reasonCode, reason);
  });
}

test('CLI validates a real local file and requests observed attempt evidence before applying policy', async () => {
  const seen = [];
  const input = evidence();
  const result = await invokePolicyFile(JSON.stringify(policy()), async (coordinate) => {
    seen.push(coordinate);
    return input;
  });
  assert.equal(result.code, 2);
  assert.equal(result.report.status, 'finding');
  assert.deepEqual(input.policy, { jobs: [] });
  assert.deepEqual(seen, [{ repository, sha, runIds: ['501'], targetRef, requireRunAttempt: true }]);
});

function attemptTransport({ attempt = 2, jobRunId = 501, jobSha = sha } = {}) {
  const base = `repos/${repository}`;
  const jobEndpoint = `${base}/actions/runs/501/attempts/2/jobs?per_page=100&page=1`;
  const responses = new Map([
    [base, { default_branch: 'main' }],
    [`${base}/git/trees/${sha}?recursive=1`, { truncated: false, tree: [{ path: workflowPath, type: 'blob' }] }],
    [`${base}/actions/runs?head_sha=${sha}&per_page=100&page=1`, { total_count: 1, workflow_runs: [{
      id: 501, path: workflowPath, head_sha: sha, event: 'push', head_branch: 'main',
      status: 'completed', conclusion: 'success', pull_requests: [], run_attempt: attempt,
    }] }],
    [`${base}/contents/${encodeURIComponent(workflowPath)}?ref=${sha}`, 'on: push\njobs:\n  gate:\n    name: gate\n'],
    [jobEndpoint, { total_count: 1, jobs: [{ name: 'gate', run_id: jobRunId, head_sha: jobSha,
      status: 'completed', conclusion: 'success', check_run_url: `https://api.github.com/${base}/check-runs/601` }] }],
    [`${base}/check-runs/601`, { id: 601, name: 'gate', head_sha: sha, status: 'completed', conclusion: 'success', app: { id: 15368 } }],
    [`${base}/rulesets?includes_parents=true&targets=branch&per_page=100&page=1`, []],
    [`${base}/branches/main/protection`, { required_status_checks: { contexts: ['gate'] } }],
  ]);
  const calls = [];
  return { calls, jobEndpoint, execFileImpl: async (file, args) => {
    assert.equal(file, 'gh');
    assert.deepEqual(args.slice(0, 3), ['api', '--method', 'GET']);
    const endpoint = args.at(-1);
    calls.push(endpoint);
    assert.ok(responses.has(endpoint), 'Unexpected synthetic endpoint');
    const body = responses.get(endpoint);
    return { stdout: typeof body === 'string' ? body : JSON.stringify(body), stderr: '' };
  } };
}

test('policy-bound collection uses the observed attempt-specific GET without inventing job run_attempt', async () => {
  const transport = attemptTransport();
  const input = await collectWithGh({ repository, sha, runIds: ['501'], targetRef, requireRunAttempt: true }, transport);
  assert.equal(input.collection.complete, true);
  assert.equal(input.observedRuns[0].runAttempt, 2);
  assert.ok(transport.calls.includes(transport.jobEndpoint));
  assert.equal(transport.calls.some((endpoint) => endpoint.includes('/actions/runs/501/jobs?')), false);
});

for (const [name, options] of [
  ['missing attempt', { attempt: null }], ['zero attempt', { attempt: 0 }],
  ['fractional attempt', { attempt: 1.5 }], ['contradictory job run', { jobRunId: 999 }],
  ['contradictory job SHA', { jobSha: 'f'.repeat(40) }],
]) {
  test(`policy-bound ${name} fails closed`, async () => {
    const input = await collectWithGh({ repository, sha, runIds: ['501'], targetRef, requireRunAttempt: true }, attemptTransport(options));
    const report = await auditControlPlane(input);
    assert.equal(report.status, 'collection-error');
    assert.equal(report.results[0].reasonCode, 'GH_COLLECTION_FAILED');
  });
}
