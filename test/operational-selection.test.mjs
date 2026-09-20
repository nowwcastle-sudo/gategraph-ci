import assert from 'node:assert/strict';
import test from 'node:test';
import { collectWithGh } from '../src/gh-adapter.mjs';
import { auditControlPlane } from '../src/audit-control-plane.mjs';
import { runCli } from '../bin/gategraph.mjs';

const repository = 'example/project';
const sha = '0123456789abcdef0123456789abcdef01234567';

for (const runIds of [[], ['0'], ['01'], ['501', '501'], ['1/2'], ['9007199254740992']]) {
  test(`invalid selection ${JSON.stringify(runIds)} never invokes gh`, async () => {
    let calls = 0;
    await assert.rejects(collectWithGh({ repository, sha, runIds }, {
      execFileImpl: async () => { calls += 1; throw new Error('unexpected call'); },
    }), TypeError);
    assert.equal(calls, 0);
  });
}

const workflowPath = '.github/workflows/ci.yml';
const extraPath = '.github/workflows/extra.yml';
const makeRun = (id, changes = {}) => ({ id, path: workflowPath, event: 'push', head_sha: sha,
  head_branch: 'main', status: 'completed', conclusion: 'success', pull_requests: [], ...changes });

function makeTransport({ runs, workflowPaths = [workflowPath], requiredContexts = ['gate'] }) {
  const calls = [];
  const checkName = (run) => run.path === workflowPath ? 'gate' : 'extra-gate';
  const execFileImpl = async (file, args) => {
    assert.equal(file, 'gh');
    assert.deepEqual(args.slice(0, 3), ['api', '--method', 'GET']);
    const endpoint = args.at(-1);
    calls.push(endpoint);
    const base = `repos/${repository}`;
    let body;
    if (endpoint === base) body = { default_branch: 'main' };
    else if (endpoint === `${base}/git/trees/${sha}?recursive=1`) {
      body = { truncated: false, tree: workflowPaths.map((path) => ({ path, type: 'blob' })) };
    } else if (endpoint.startsWith(`${base}/contents/`)) {
      const path = decodeURIComponent(endpoint.slice(`${base}/contents/`.length).split('?')[0]);
      assert.ok(workflowPaths.includes(path));
      assert.ok(endpoint.endsWith(`?ref=${sha}`));
      return { stdout: `on: [push, pull_request]\njobs:\n  gate:\n    name: ${path === workflowPath ? 'gate' : 'extra-gate'}\n`, stderr: '' };
    } else if (endpoint === `${base}/actions/runs?head_sha=${sha}&per_page=100&page=1`) {
      body = { total_count: runs.length, workflow_runs: runs };
    } else if (endpoint.includes('/jobs?')) {
      const run = runs.find((item) => endpoint === `${base}/actions/runs/${item.id}/jobs?per_page=100&page=1`);
      assert.ok(run);
      body = { total_count: 1, jobs: [{ name: checkName(run), status: 'completed', conclusion: 'success',
        check_run_url: `https://api.github.com/${base}/check-runs/${run.id + 100}` }] };
    } else if (endpoint.includes('/check-runs/')) {
      const run = runs.find((item) => endpoint === `${base}/check-runs/${item.id + 100}`);
      assert.ok(run);
      body = { id: run.id + 100, name: checkName(run), head_sha: sha, status: 'completed',
        conclusion: 'success', app: { id: 15368 } };
    } else if (endpoint === `${base}/rulesets?includes_parents=true&targets=branch&per_page=100&page=1`) {
      body = [{ id: 91 }];
    } else if (endpoint === `${base}/rulesets/91?includes_parents=true`) {
      body = { id: 91, target: 'branch', enforcement: 'active',
        conditions: { ref_name: { include: ['refs/heads/main', 'refs/heads/release'], exclude: [] } },
        rules: [{ type: 'required_status_checks', parameters: {
          required_status_checks: requiredContexts.map((context) => ({ context, integration_id: 15368 })),
        } }] };
    } else if (/\/branches\/(main|release)\/protection$/.test(endpoint)) {
      body = { required_status_checks: null };
    } else assert.fail('Unexpected synthetic GET endpoint');
    return { stdout: JSON.stringify(body), stderr: '' };
  };
  return { calls, execFileImpl };
}

test('explicit selection scopes workflows and excludes unsupported incomplete runs', async () => {
  const transport = makeTransport({ runs: [makeRun(501), makeRun(502, {
    path: extraPath, event: 'workflow_dispatch', status: 'in_progress', conclusion: null,
  })], workflowPaths: [workflowPath, extraPath] });
  const input = await collectWithGh({ repository, sha, runIds: ['501'], targetRef: 'refs/heads/main' }, transport);
  assert.equal(input.collection.complete, true);
  assert.deepEqual(input.workflows.map((item) => item.path), [workflowPath]);
  assert.deepEqual(input.collection.scope, { kind: 'selected-runs', repository, sha,
    targetRef: 'refs/heads/main', runIds: ['501'], excludedRunIds: ['502'], excludedWorkflowPaths: [extraPath] });
  assert.equal(transport.calls.some((endpoint) => endpoint.includes(encodeURIComponent(extraPath))), false);
  const report = await auditControlPlane(input);
  assert.equal(report.status, 'unknown', JSON.stringify(report.results));
  assert.deepEqual(report.provenance.scope, input.collection.scope);
});

for (const [name, runs, options, reason] of [
  ['legacy mixed unsupported event', [makeRun(501), makeRun(502, { event: 'workflow_dispatch' })], {}, 'TARGET_REF_UNRESOLVED'],
  ['selected unsupported event', [makeRun(501), makeRun(502, { event: 'workflow_dispatch' })], { runIds: ['501', '502'] }, 'TARGET_REF_UNRESOLVED'],
  ['missing selected ID', [makeRun(501)], { runIds: ['999'] }, 'RUN_SELECTION_MISMATCH'],
  ['selected SHA mismatch', [makeRun(501, { head_sha: 'f'.repeat(40) })], { runIds: ['501'] }, 'GH_COLLECTION_FAILED'],
  ['target assertion mismatch', [makeRun(501, { head_branch: 'release' })], { runIds: ['501'], targetRef: 'refs/heads/main' }, 'TARGET_REF_MISMATCH'],
  ['missing inline PR base', [makeRun(501, { event: 'pull_request' })], { runIds: ['501'], targetRef: 'refs/heads/main' }, 'TARGET_REF_UNRESOLVED'],
  ['partially missing PR bases', [makeRun(501, { event: 'pull_request', pull_requests: [{ base: { ref: 'main' } }, {}] })], { runIds: ['501'] }, 'TARGET_REF_UNRESOLVED'],
  ['conflicting selected targets', [makeRun(501), makeRun(502, { head_branch: 'release' })], { runIds: ['501', '502'] }, 'TARGET_REF_UNRESOLVED'],
  ['multiple selected runs per workflow', [makeRun(501), makeRun(502)], { runIds: ['501', '502'] }, 'RUN_SELECTION_AMBIGUOUS'],
  ['selected unfinished run', [makeRun(501, { status: 'in_progress', conclusion: null })], { runIds: ['501'] }, 'RUN_LIFECYCLE_AMBIGUOUS'],
]) {
  test(`${name} fails closed through collector and core`, async () => {
    const input = await collectWithGh({ repository, sha, ...options }, makeTransport({ runs }));
    const report = await auditControlPlane(input);
    assert.equal(report.status, 'collection-error');
    assert.equal(report.results[0].reasonCode, reason);
    assert.equal(report.results.some((item) => item.status === 'finding'), false);
  });
}

test('two selected workflows work and excluding one never removes its active requirement', async () => {
  const configuration = { runs: [makeRun(501), makeRun(503, { path: extraPath })],
    workflowPaths: [workflowPath, extraPath], requiredContexts: ['gate', 'extra-gate'] };
  const both = await collectWithGh({ repository, sha, runIds: ['503', '501'] }, makeTransport(configuration));
  const bothReport = await auditControlPlane(both);
  assert.equal(bothReport.status, 'unknown', JSON.stringify(bothReport.results));
  assert.deepEqual(both.collection.scope.runIds, ['501', '503']);
  const one = await collectWithGh({ repository, sha, runIds: ['501'] }, makeTransport(configuration));
  assert.equal(one.controlPlane.rulesets[0].requiredStatusChecks.length, 2);
  const report = await auditControlPlane(one);
  assert.equal(report.status, 'collection-error');
  assert.deepEqual(report.results[0].unresolvedPremises, ['REQUIRED_CONTEXT_IDENTITY_UNRESOLVED']);
});

for (const [name, mutate] of [
  ['repository', (scope) => { scope.repository = 'other/project'; }],
  ['SHA', (scope) => { scope.sha = 'f'.repeat(40); }],
  ['target', (scope) => { scope.targetRef = 'refs/heads/release'; }],
  ['selected IDs', (scope) => { scope.runIds = ['999']; }],
  ['overlapping IDs', (scope) => { scope.excludedRunIds = ['501']; }],
  ['overlapping workflows', (scope) => { scope.excludedWorkflowPaths = [workflowPath]; }],
  ['noncanonical path', (scope) => { scope.excludedWorkflowPaths = ['.github/workflows/../bad.yml']; }],
  ['unknown key', (scope) => { scope.extra = 'SCOPE_EXTRA_CANARY'; }],
]) {
  test(`scope tampering with ${name} is rejected without reflection`, async () => {
    const input = await collectWithGh({ repository, sha, runIds: ['501'] }, makeTransport({ runs: [makeRun(501)] }));
    mutate(input.collection.scope);
    const report = await auditControlPlane(input);
    assert.equal(report.status, 'collection-error');
    assert.equal(report.results[0].reasonCode, 'SCOPE_COORDINATE_MISMATCH');
    assert.equal(Object.hasOwn(report.provenance, 'scope'), false);
    assert.equal(JSON.stringify(report).includes('SCOPE_EXTRA_CANARY'), false);
  });
}

test('CLI forwards only normalized selection fields in any option order', async () => {
  const calls = [];
  const exit = await runCli(['audit', '--run-id', '503', '--sha', sha, '--target-ref', 'refs/heads/main',
    '--repo', repository, '--run-id', '501'], {
    collectWithGh: async (coordinate) => { calls.push(coordinate); return {}; },
    auditControlPlane: async () => ({ status: 'unknown' }),
    stdout: { write() {} }, stderr: { write() { assert.fail('unexpected usage'); } },
  });
  assert.equal(exit, 0);
  assert.deepEqual(calls, [{ repository, sha, runIds: ['501', '503'], targetRef: 'refs/heads/main' }]);
});

for (const extra of [['--run-id', '0'], ['--run-id', '501', '--run-id', '501'],
  ['--target-ref', 'main'], ['--target-ref', 'refs/heads/main', '--target-ref', 'refs/heads/main'], ['--run-id']]) {
  test(`malformed CLI selection ${JSON.stringify(extra)} invokes no dependency`, async () => {
    let output = '';
    const exit = await runCli(['audit', '--repo', repository, '--sha', sha, ...extra], {
      collectWithGh: async () => { assert.fail('collector invoked'); },
      auditControlPlane: async () => { assert.fail('core invoked'); },
      stdout: { write() { assert.fail('unexpected stdout'); } }, stderr: { write(value) { output += value; } },
    });
    assert.equal(exit, 1);
    assert.match(output, /^Usage: gategraph audit/);
  });
}

test('sparse run ID arrays are rejected before collection', async () => {
  let calls = 0;
  await assert.rejects(collectWithGh({ repository, sha, runIds: new Array(1) }, {
    execFileImpl: async () => { calls += 1; throw new Error('unexpected collection'); },
  }), TypeError);
  assert.equal(calls, 0);
});

test('sparse excluded workflow arrays cannot become scope provenance', async () => {
  const input = await collectWithGh({ repository, sha, runIds: ['501'] }, makeTransport({ runs: [makeRun(501)] }));
  input.collection.scope.excludedWorkflowPaths = new Array(1);
  const report = await auditControlPlane(input);
  assert.equal(report.results[0].reasonCode, 'SCOPE_COORDINATE_MISMATCH');
  assert.equal(Object.hasOwn(report.provenance, 'scope'), false);
});

for (const [name, subjectKey, scopeKey, invalid] of [
  ['invalid repository', 'repository', 'repository', 'INVALID_REPOSITORY_CANARY'],
  ['repository array', 'repository', 'repository', [repository]],
  ['SHA array', 'sha', 'sha', [sha]],
  ['ref array', 'ref', 'targetRef', ['refs/heads/main']],
]) {
  test(`combined subject and scope ${name} cannot emit scope provenance`, async () => {
    const input = await collectWithGh({ repository, sha, runIds: ['501'] }, makeTransport({ runs: [makeRun(501)] }));
    input.subject[subjectKey] = invalid;
    input.collection.scope[scopeKey] = invalid;
    const report = await auditControlPlane(input);
    assert.equal(report.status, 'collection-error');
    assert.equal(report.results[0].reasonCode, 'EVIDENCE_INCOMPLETE');
    assert.deepEqual(report.results[0].unresolvedPremises, ['INVALID_SUBJECT_COORDINATE']);
    assert.equal(Object.hasOwn(report.provenance, 'scope'), false);
  });
}
