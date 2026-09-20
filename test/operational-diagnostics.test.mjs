import assert from 'node:assert/strict';
import test from 'node:test';
import { auditControlPlane } from '../src/audit-control-plane.mjs';
import { collectWithGh } from '../src/gh-adapter.mjs';
import { loadFixtureEvidence } from './helpers/fixture-adapter.mjs';

async function unresolvedInput() {
  const input = await loadFixtureEvidence(new URL('./fixtures/aggregate-omission/', import.meta.url));
  delete input.subject.ref;
  input.collection.complete = false;
  input.collection.sources.push({ name: 'actions-runs', outcome: 'failed',
    complete: false, reasonCode: 'TARGET_REF_UNRESOLVED' });
  return input;
}

test('keeps the target-resolution cause when its missing ref makes the subject incomplete', async () => {
  const report = await auditControlPlane(await unresolvedInput());
  assert.equal(report.status, 'collection-error');
  assert.equal(report.results[0].reasonCode, 'TARGET_REF_UNRESOLVED');
  assert.equal(report.provenance.sources.at(-1).name, 'actions-runs');
  assert.match(report.results[0].recoveryAction, /missing PR base/);
  assert.equal(report.results.some((result) => result.status === 'finding'), false);
});

for (const variant of ['absent failure', 'unrecognized reason', 'observed source']) {
  test(`missing ref remains a coordinate error with ${variant}`, async () => {
    const input = await unresolvedInput();
    const canary = 'UNRECOGNIZED_REASON_CANARY';
    if (variant === 'absent failure') input.collection.sources.pop();
    if (variant === 'unrecognized reason') input.collection.sources.at(-1).reasonCode = canary;
    if (variant === 'observed source') {
      input.collection.sources.at(-1).outcome = 'observed';
      input.collection.sources.at(-1).complete = true;
    }
    const report = await auditControlPlane(input);
    assert.equal(report.status, 'collection-error');
    assert.equal(report.results[0].reasonCode, 'EVIDENCE_INCOMPLETE');
    assert.deepEqual(report.results[0].unresolvedPremises, ['INVALID_SUBJECT_COORDINATE']);
    assert.equal(Object.hasOwn(report.results[0], 'recoveryAction'), false);
    assert.equal(JSON.stringify(report).includes(canary), false);
  });
}

test('invalid GitHub identity is rejected before recognizing a failed-source cause', async () => {
  const input = await unresolvedInput();
  input.subject.kind = 'github';
  const report = await auditControlPlane(input);
  assert.equal(report.status, 'collection-error');
  assert.equal(report.results[0].reasonCode, 'EVIDENCE_INCOMPLETE');
  assert.deepEqual(report.results[0].unresolvedPremises, ['INVALID_SUBJECT_COORDINATE']);
});

test('a live-shaped missing PR base preserves its failed source through collector and core', async () => {
  const repository = 'example/project';
  const sha = '0123456789abcdef0123456789abcdef01234567';
  const path = '.github/workflows/ci.yml';
  const endpoint = `repos/${repository}/actions/runs?head_sha=${sha}&per_page=100&page=1`;
  const responses = new Map([
    [`repos/${repository}`, JSON.stringify({ default_branch: 'main' })],
    [`repos/${repository}/git/trees/${sha}?recursive=1`, JSON.stringify({
      truncated: false, tree: [{ path, type: 'blob' }],
    })],
    [`repos/${repository}/contents/${encodeURIComponent(path)}?ref=${sha}`,
      'on: pull_request\njobs:\n  gate:\n    name: gate\n'],
    [endpoint, JSON.stringify({ total_count: 1, workflow_runs: [{
      id: 501, path, head_sha: sha, event: 'pull_request', head_branch: 'feature',
      status: 'completed', conclusion: 'success', pull_requests: [],
    }] })],
  ]);
  const calls = [];
  const input = await collectWithGh({ repository, sha }, {
    execFileImpl: async (file, args) => {
      assert.equal(file, 'gh');
      assert.deepEqual(args.slice(0, 3), ['api', '--method', 'GET']);
      assert.ok(responses.has(args.at(-1)));
      calls.push(args.at(-1));
      return { stdout: responses.get(args.at(-1)), stderr: '' };
    },
  });
  const report = await auditControlPlane(input);
  assert.equal(report.status, 'collection-error');
  assert.equal(report.results[0].reasonCode, 'TARGET_REF_UNRESOLVED');
  assert.match(report.results[0].recoveryAction, /missing PR base/);
  assert.ok(report.provenance.sources.some((source) => source.endpoint === endpoint &&
    source.reasonCode === 'TARGET_REF_UNRESOLVED' && source.outcome === 'failed'));
  assert.equal(input.subject.ref, undefined);
  assert.equal(calls.length, 4);
});
