import assert from 'node:assert/strict';
import test from 'node:test';
import { auditControlPlane } from '../src/audit-control-plane.mjs';
import { collectWithGh } from '../src/gh-adapter.mjs';

const repository = 'example/project';
const sha = '0123456789abcdef0123456789abcdef01234567';
const workflowPath = '.github/workflows/ci.yml';
const workflowText = `on: pull_request
jobs:
  producer:
    name: producer
  dependency:
    name: dependency
  gate:
    name: gate
    needs: [dependency]
`;

function runDocument() {
  return {
    id: 501,
    path: workflowPath,
    event: 'pull_request',
    head_sha: sha,
    head_branch: 'feature',
    status: 'completed',
    conclusion: 'success',
    pull_requests: [{ base: { ref: 'main' } }],
  };
}

function jobDocument(id, name) {
  return {
    id,
    name,
    head_sha: sha,
    status: 'completed',
    conclusion: 'success',
    check_run_url: `https://api.github.com/repos/${repository}/check-runs/${id}`,
  };
}

function responseFor(endpoint, overrides = {}) {
  if (Object.hasOwn(overrides, endpoint)) return overrides[endpoint];
  if (endpoint === `repos/${repository}`) return JSON.stringify({ default_branch: 'main' });
  if (endpoint === `repos/${repository}/git/trees/${sha}?recursive=1`) {
    return JSON.stringify({
      truncated: false,
      tree: [{ path: workflowPath, type: 'blob', sha: 'a'.repeat(40) }],
    });
  }
  if (endpoint === `repos/${repository}/contents/${encodeURIComponent(workflowPath)}?ref=${sha}`) {
    return workflowText;
  }
  if (endpoint === `repos/${repository}/actions/runs?head_sha=${sha}&per_page=100&page=1`) {
    return JSON.stringify({ total_count: 1, workflow_runs: [runDocument()] });
  }
  if (endpoint === `repos/${repository}/actions/runs/501/jobs?per_page=100&page=1`) {
    return JSON.stringify({
      total_count: 3,
      jobs: [jobDocument(601, 'producer'), jobDocument(602, 'dependency'), jobDocument(603, 'gate')],
    });
  }
  const checkMatch = endpoint.match(new RegExp(`^repos/${repository}/check-runs/(60[1-3])$`));
  if (checkMatch) {
    const names = { 601: 'producer', 602: 'dependency', 603: 'gate' };
    return JSON.stringify({
      id: Number(checkMatch[1]),
      name: names[checkMatch[1]],
      head_sha: sha,
      status: 'completed',
      conclusion: 'success',
      app: { id: 15368, slug: 'github-actions' },
    });
  }
  if (endpoint === `repos/${repository}/rulesets?includes_parents=true&targets=branch&per_page=100&page=1`) {
    return JSON.stringify([{ id: 91 }]);
  }
  if (endpoint === `repos/${repository}/rulesets/91?includes_parents=true`) {
    return JSON.stringify({
      id: 91,
      target: 'branch',
      enforcement: 'active',
      conditions: { ref_name: { include: ['refs/heads/main'], exclude: [] } },
      rules: [{
        type: 'required_status_checks',
        parameters: {
          required_status_checks: [{ context: 'gate', integration_id: 15368 }],
          strict_required_status_checks_policy: true,
        },
      }],
    });
  }
  if (endpoint === `repos/${repository}/branches/main/protection`) {
    return JSON.stringify({
      required_status_checks: {
        contexts: ['gate'],
        checks: [{ context: 'gate', app_id: 15368 }],
      },
    });
  }
  throw new Error(`Missing synthetic response for ${endpoint}`);
}

function makeExecFile(overrides = {}) {
  const calls = [];
  return {
    calls,
    execFileImpl: async (file, args, options) => {
      assert.equal(file, 'gh');
      assert.deepEqual(args.slice(0, 3), ['api', '--method', 'GET']);
      assert.deepEqual(options, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
      const endpoint = args.at(-1);
      calls.push(endpoint);
      const response = responseFor(endpoint, overrides);
      if (response instanceof Error) throw response;
      return { stdout: response, stderr: '' };
    },
  };
}

test('rejects invalid repository and SHA coordinates before invoking gh', async () => {
  let calls = 0;
  const execFileImpl = async () => { calls += 1; };

  await assert.rejects(
    collectWithGh({ repository: 'example/project/extra', sha }, { execFileImpl }),
    { name: 'TypeError', message: 'repository must be owner/name' },
  );
  await assert.rejects(
    collectWithGh({ repository, sha: sha.slice(1) }, { execFileImpl }),
    { name: 'TypeError', message: 'sha must be a 40-character hexadecimal commit' },
  );
  assert.equal(calls, 0);
});

test('fails closed when the recursive tree response is truncated', async () => {
  const treeEndpoint = `repos/${repository}/git/trees/${sha}?recursive=1`;
  const { execFileImpl } = makeExecFile({
    [treeEndpoint]: JSON.stringify({ truncated: true, tree: [] }),
  });

  const input = await collectWithGh({ repository, sha }, { execFileImpl });
  const treeSource = input.collection.sources.find((source) => source.name === 'tree');

  assert.equal(input.collection.complete, false);
  assert.equal(treeSource.reasonCode, 'TREE_TRUNCATED');
  assert.equal(treeSource.complete, false);
});

test('turns a gh failure into sanitized incomplete collection evidence', async () => {
  const failure = Object.assign(new Error('TOKEN_CANARY_ADAPTER_9f13'), {
    code: 1,
    stdout: 'STDOUT_CANARY_ADAPTER_9f13',
    stderr: 'HTTP 500 STDERR_CANARY_ADAPTER_9f13',
  });
  const { execFileImpl } = makeExecFile({ [`repos/${repository}`]: failure });

  const input = await collectWithGh({ repository, sha }, { execFileImpl });
  const serialized = JSON.stringify(input);

  assert.equal(input.collection.complete, false);
  assert.equal(input.collection.sources[0].reasonCode, 'GH_COLLECTION_FAILED');
  for (const forbidden of [
    'TOKEN_CANARY_ADAPTER_9f13',
    'STDOUT_CANARY_ADAPTER_9f13',
    'STDERR_CANARY_ADAPTER_9f13',
    'stdout',
    'stderr',
    'stack',
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test('follows job pagination using the documented total_count envelope', async () => {
  const pageOne = `repos/${repository}/actions/runs/501/jobs?per_page=100&page=1`;
  const pageTwo = `repos/${repository}/actions/runs/501/jobs?per_page=100&page=2`;
  const overrides = {
    [pageOne]: JSON.stringify({ total_count: 3, jobs: [jobDocument(601, 'producer')] }),
    [pageTwo]: JSON.stringify({
      total_count: 3,
      jobs: [jobDocument(602, 'dependency'), jobDocument(603, 'gate')],
    }),
  };
  const { calls, execFileImpl } = makeExecFile(overrides);

  const input = await collectWithGh({ repository, sha }, { execFileImpl });

  assert.equal(input.observedRuns[0].checkRuns.length, 3);
  assert.deepEqual(calls.filter((endpoint) => endpoint.includes('/jobs?')), [pageOne, pageTwo]);
});

test('feeds provider-qualified live shapes through the core audit seam', async () => {
  const { execFileImpl } = makeExecFile();

  const input = await collectWithGh({ repository, sha }, { execFileImpl });
  input.policy = {
    jobs: [{ workflowPath, jobId: 'producer', mergePolicy: 'voting' }],
    gates: {
      [`${workflowPath}/gate`]: {
        failurePropagation: 'all-needs',
        evidence: 'gh-adapter-fixture-gate-v1',
      },
    },
  };
  Object.assign(
    input.collection.sources.find((source) => source.name === 'policy'),
    { outcome: 'observed' },
  );
  const report = await auditControlPlane(input);

  assert.equal(input.collection.complete, true);
  assert.deepEqual(
    {
      analyzer: input.analysis.analyzer,
      version: input.analysis.version,
      contract: input.analysis.contract,
    },
    {
      analyzer: 'gategraph-ci',
      version: '0.2.0-experimental.1',
      contract: 'gategraph-audit/v1',
    },
  );
  assert.match(input.analysis.analyzedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(report.status, 'finding');
  assert.equal(report.provenance.analyzedAt, input.analysis.analyzedAt);
  assert.equal(report.results[0].producerJobId, 'producer');
  assert.equal(report.results[0].reasonCode, 'UNCOVERED_BY_ALL_ACTIVE_GATES');
});
