import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { auditControlPlane } from '../src/audit-control-plane.mjs';
import { collectWithGh } from '../src/gh-adapter.mjs';

const repository = 'example/project';
const sha = '0123456789abcdef0123456789abcdef01234567';
const workflowPath = '.github/workflows/ci.yml';
const ref = 'refs/heads/main';
const gateId = `${workflowPath}/gate`;

function source(name, extra = {}) {
  return { name, outcome: 'observed', complete: true, ...extra };
}

function makeAlwaysGateInput({
  gatePolicies,
  workflowText = `on: pull_request
jobs:
  covered:
    name: covered
  uncovered:
    name: uncovered
  gate:
    name: gate
    if: always()
    needs: [covered]
    steps:
      - run: exit 0
`,
} = {}) {
  const policy = {
    jobs: [
      { workflowPath, jobId: 'covered', mergePolicy: 'voting' },
      { workflowPath, jobId: 'uncovered', mergePolicy: 'voting' },
    ],
    ...(gatePolicies === undefined ? {} : { gates: gatePolicies }),
  };
  return {
    analysis: {
      analyzer: 'gategraph-ci',
      version: '0.2.0-experimental.1',
      contract: 'gategraph-audit/v1',
      analyzedAt: '2026-09-05T00:00:00.000Z',
    },
    subject: {
      kind: 'github',
      id: `${repository}@${sha}`,
      repository,
      ref,
      defaultBranchRef: ref,
      sha,
    },
    workflows: [{ path: workflowPath, sha, text: workflowText }],
    controlPlane: {
      rulesets: [{
        id: 91,
        target: 'branch',
        enforcement: 'active',
        conditions: { refName: { include: [ref], exclude: [] } },
        requiredStatusChecks: [{ context: 'gate', integrationId: 15368 }],
      }],
      classicProtection: { state: 'observed', targetRef: ref, requiredStatusChecks: [] },
    },
    observedRuns: [{
      event: 'pull_request',
      sha,
      runId: '501',
      workflowPath,
      targetRef: ref,
      status: 'completed',
      conclusion: 'success',
      checkRuns: ['covered', 'uncovered', 'gate'].map((name) => ({
        name,
        sha,
        status: 'completed',
        conclusion: 'success',
        provider: { kind: 'github-app', integrationId: 15368 },
      })),
    }],
    policy,
    collection: {
      complete: true,
      sources: [
        source('workflow', { path: workflowPath, sha }),
        source('control-plane', { ref }),
        source('observed-runs', { runId: '501', sha, pagesComplete: true }),
        source('policy'),
      ],
    },
  };
}

function releaseTargetExecFile() {
  const releaseRef = 'refs/heads/release';
  const responses = new Map([
    [`repos/${repository}`, JSON.stringify({ default_branch: 'main' })],
    [`repos/${repository}/git/trees/${sha}?recursive=1`, JSON.stringify({
      truncated: false,
      tree: [{ path: workflowPath, type: 'blob', sha: 'a'.repeat(40) }],
    })],
    [`repos/${repository}/contents/${encodeURIComponent(workflowPath)}?ref=${sha}`,
      'on: pull_request\njobs:\n  gate:\n    name: gate\n'],
    [`repos/${repository}/actions/runs?head_sha=${sha}&per_page=100&page=1`, JSON.stringify({
      total_count: 1,
      workflow_runs: [{
        id: 501,
        path: workflowPath,
        event: 'pull_request',
        head_sha: sha,
        head_branch: 'feature',
        status: 'completed',
        conclusion: 'success',
        pull_requests: [{ base: { ref: 'release' } }],
      }],
    })],
    [`repos/${repository}/actions/runs/501/jobs?per_page=100&page=1`, JSON.stringify({
      total_count: 1,
      jobs: [{
        id: 601,
        name: 'gate',
        head_sha: sha,
        status: 'completed',
        conclusion: 'success',
        check_run_url: `https://api.github.com/repos/${repository}/check-runs/601`,
      }],
    })],
    [`repos/${repository}/check-runs/601`, JSON.stringify({
      id: 601,
      name: 'gate',
      head_sha: sha,
      status: 'completed',
      conclusion: 'success',
      app: { id: 15368 },
    })],
    [`repos/${repository}/rulesets?includes_parents=true&targets=branch&per_page=100&page=1`,
      JSON.stringify([{ id: 91 }])],
    [`repos/${repository}/rulesets/91?includes_parents=true`, JSON.stringify({
      id: 91,
      target: 'branch',
      enforcement: 'active',
      conditions: { ref_name: { include: [releaseRef], exclude: [] } },
      rules: [{
        type: 'required_status_checks',
        parameters: {
          required_status_checks: [{ context: 'gate', integration_id: 15368 }],
        },
      }],
    })],
    [`repos/${repository}/branches/release/protection`, JSON.stringify({
      required_status_checks: {
        contexts: ['gate'],
        checks: [{ context: 'gate', app_id: 15368 }],
      },
    })],
  ]);
  return async (file, args) => {
    assert.equal(file, 'gh');
    assert.deepEqual(args.slice(0, 3), ['api', '--method', 'GET']);
    const endpoint = args.at(-1);
    assert.equal(responses.has(endpoint), true, endpoint);
    return { stdout: responses.get(endpoint), stderr: '' };
  };
}

test('fails closed when always() has no exact failure-propagation policy', async () => {
  const report = await auditControlPlane(makeAlwaysGateInput());

  assert.equal(report.status, 'collection-error');
  assert.equal(report.results[0].reasonCode, 'UNSUPPORTED_OR_AMBIGUOUS_EVIDENCE');
  assert.equal(report.results.some((result) => result.status === 'finding'), false);
});

test('uses exact all-needs policy for transitive coverage and preserves its provenance', async () => {
  const gatePolicy = {
    failurePropagation: 'all-needs',
    evidence: 'fixture-policy-gate-1',
  };
  const report = await auditControlPlane(makeAlwaysGateInput({
    gatePolicies: { [gateId]: gatePolicy },
  }));
  const evidenceFingerprint = createHash('sha256')
    .update(gatePolicy.evidence, 'utf8')
    .digest('hex')
    .slice(0, 12);

  assert.equal(report.status, 'finding');
  assert.deepEqual(
    report.results.filter((result) => result.status === 'finding').map((result) => result.producerJobId),
    ['uncovered'],
  );
  assert.deepEqual(report.provenance.gatePolicies, [{
    gateId,
    failurePropagation: 'all-needs',
    evidenceFingerprint,
  }]);
});

for (const [name, gatePolicies] of [
  ['unknown gate ID', { [`${workflowPath}/missing`]: {
    failurePropagation: 'all-needs', evidence: 'fixture-policy-gate-1',
  } }],
  ['unknown propagation', { [gateId]: {
    failurePropagation: 'some-needs', evidence: 'fixture-policy-gate-1',
  } }],
  ['empty evidence', { [gateId]: { failurePropagation: 'all-needs', evidence: '' } }],
  ['non-exact record', { [gateId]: {
    failurePropagation: 'all-needs', evidence: 'fixture-policy-gate-1', note: 'extra',
  } }],
]) {
  test(`rejects ${name} in policy.gates`, async () => {
    const report = await auditControlPlane(makeAlwaysGateInput({ gatePolicies }));

    assert.equal(report.status, 'collection-error');
    assert.equal(report.results[0].reasonCode, 'UNSUPPORTED_OR_AMBIGUOUS_EVIDENCE');
    assert.equal(report.results.some((result) => result.status === 'finding'), false);
  });
}

test('rejects a custom gate condition other than policy-backed always()', async () => {
  const input = makeAlwaysGateInput({
    gatePolicies: {
      [gateId]: { failurePropagation: 'all-needs', evidence: 'fixture-policy-gate-1' },
    },
  });
  input.workflows[0].text = input.workflows[0].text.replace('if: always()', 'if: success()');

  const report = await auditControlPlane(input);

  assert.equal(report.status, 'collection-error');
  assert.equal(report.results[0].reasonCode, 'UNSUPPORTED_OR_AMBIGUOUS_EVIDENCE');
});

test('audits a release target collected from a repository whose default branch is main', async () => {
  const input = await collectWithGh({ repository, sha }, { execFileImpl: releaseTargetExecFile() });
  const repositorySource = input.collection.sources.find((item) => item.name === 'repository');

  assert.equal(input.subject.ref, 'refs/heads/release');
  assert.equal(input.subject.defaultBranchRef, 'refs/heads/main');
  assert.equal(repositorySource.defaultBranchRef, 'refs/heads/main');
  assert.equal(Object.hasOwn(repositorySource, 'ref'), false);

  const report = await auditControlPlane(input);

  assert.equal(report.status, 'unknown');
  assert.equal(report.results[0].reasonCode, 'NO_UNCOVERED_PATH_PROVEN');
});
