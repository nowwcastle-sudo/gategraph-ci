import assert from 'node:assert/strict';
import test from 'node:test';
import { collectWithGh } from '../src/gh-adapter.mjs';

const repository = 'example/project';
const sha = '0123456789abcdef0123456789abcdef01234567';
const workflowPath = '.github/workflows/ci.yml';
const targetRef = 'release';

const allowedEndpoints = [
  /^repos\/example\/project$/,
  /^repos\/example\/project\/git\/trees\/[0-9a-f]{40}\?recursive=1$/,
  /^repos\/example\/project\/contents\/.+\?ref=[0-9a-f]{40}$/,
  /^repos\/example\/project\/rulesets\?includes_parents=true&targets=branch&per_page=100&page=\d+$/,
  /^repos\/example\/project\/rulesets\/\d+\?includes_parents=true$/,
  /^repos\/example\/project\/branches\/[^/]+\/protection$/,
  /^repos\/example\/project\/actions\/runs\?head_sha=[0-9a-f]{40}&per_page=100&page=\d+$/,
  /^repos\/example\/project\/actions\/runs\/\d+\/jobs\?per_page=100&page=\d+$/,
  /^repos\/example\/project\/check-runs\/\d+$/,
];

function runDocument({
  id = 501,
  path = workflowPath,
  status = 'completed',
  conclusion = 'success',
  event = 'pull_request',
  baseRef = targetRef,
  headBranch = 'feature',
} = {}) {
  return {
    id,
    path,
    event,
    head_sha: sha,
    head_branch: headBranch,
    status,
    conclusion,
    pull_requests: baseRef === null ? [] : [{ base: { ref: baseRef } }],
  };
}

function jobDocument({ id = 601, name = 'gate' } = {}) {
  return {
    id,
    name,
    head_sha: sha,
    status: 'completed',
    conclusion: 'success',
    check_run_url: `https://api.github.com/repos/${repository}/check-runs/${id}`,
  };
}

function rulesetDocument({ id = 91, context = 'gate' } = {}) {
  return {
    id,
    target: 'branch',
    enforcement: 'active',
    conditions: { ref_name: { include: [`refs/heads/${targetRef}`], exclude: [] } },
    rules: [{
      type: 'required_status_checks',
      parameters: {
        required_status_checks: [{ context, integration_id: 15368 }],
        strict_required_status_checks_policy: true,
      },
    }],
  };
}

function standardResponse(endpoint) {
  if (endpoint === `repos/${repository}`) {
    return JSON.stringify({ default_branch: 'main' });
  }
  if (endpoint === `repos/${repository}/git/trees/${sha}?recursive=1`) {
    return JSON.stringify({
      sha,
      truncated: false,
      tree: [{ path: workflowPath, type: 'blob', sha: 'a'.repeat(40) }],
    });
  }
  if (endpoint === `repos/${repository}/contents/${encodeURIComponent(workflowPath)}?ref=${sha}`) {
    return 'on: pull_request\njobs:\n  gate:\n    name: gate\n';
  }
  if (endpoint === `repos/${repository}/actions/runs?head_sha=${sha}&per_page=100&page=1`) {
    return JSON.stringify({ total_count: 1, workflow_runs: [runDocument()] });
  }
  if (endpoint === `repos/${repository}/actions/runs/501/jobs?per_page=100&page=1`) {
    return JSON.stringify({ total_count: 1, jobs: [jobDocument()] });
  }
  if (endpoint === `repos/${repository}/check-runs/601`) {
    return JSON.stringify({
      id: 601,
      name: 'gate',
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
    return JSON.stringify(rulesetDocument());
  }
  if (endpoint === `repos/${repository}/branches/${targetRef}/protection`) {
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
  const execFileImpl = async (file, args, options) => {
    assert.equal(file, 'gh');
    assert.deepEqual(args.slice(0, 3), ['api', '--method', 'GET']);
    assert.deepEqual(options, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    const endpoint = args.at(-1);
    assert.equal(allowedEndpoints.some((pattern) => pattern.test(endpoint)), true, endpoint);
    calls.push(endpoint);
    const response = Object.hasOwn(overrides, endpoint) ? overrides[endpoint] : standardResponse(endpoint);
    if (typeof response === 'function') return { stdout: response(endpoint), stderr: '' };
    if (response instanceof Error) throw response;
    return { stdout: response, stderr: '' };
  };
  return { calls, execFileImpl };
}

test('retains authoritative target, ruleset applicability, lifecycle, and provider identity', async () => {
  const { calls, execFileImpl } = makeExecFile();

  const input = await collectWithGh({ repository, sha }, { execFileImpl });

  assert.equal(input.subject.ref, 'refs/heads/release');
  assert.equal(input.subject.defaultBranchRef, 'refs/heads/main');
  assert.deepEqual(input.controlPlane.rulesets, [{
    id: 91,
    target: 'branch',
    enforcement: 'active',
    conditions: { refName: { include: ['refs/heads/release'], exclude: [] } },
    requiredStatusChecks: [{ context: 'gate', integrationId: 15368 }],
  }]);
  assert.deepEqual(input.controlPlane.classicProtection, {
    state: 'observed',
    targetRef: 'refs/heads/release',
    requiredStatusChecks: [{ context: 'gate', integrationId: 15368 }],
  });
  assert.deepEqual(input.observedRuns, [{
    event: 'pull_request',
    sha,
    runId: '501',
    workflowPath,
    targetRef: 'refs/heads/release',
    status: 'completed',
    conclusion: 'success',
    checkRuns: [{
      name: 'gate',
      sha,
      status: 'completed',
      conclusion: 'success',
      provider: { kind: 'github-app', integrationId: 15368 },
    }],
  }]);
  assert.equal(input.collection.complete, true);
  assert.equal(input.collection.sources.every((item) => item.complete === true), true);
  assert.equal(calls.includes(`repos/${repository}/check-runs/601`), true);
});

test('paginates ruleset lists through a second page', async () => {
  const pageOneEndpoint = `repos/${repository}/rulesets?includes_parents=true&targets=branch&per_page=100&page=1`;
  const pageTwoEndpoint = `repos/${repository}/rulesets?includes_parents=true&targets=branch&per_page=100&page=2`;
  const pageOne = Array.from({ length: 100 }, (_, index) => ({ id: index + 1 }));
  const pageTwo = [{ id: 101 }];
  const overrides = {
    [pageOneEndpoint]: JSON.stringify(pageOne),
    [pageTwoEndpoint]: JSON.stringify(pageTwo),
  };
  for (let id = 1; id <= 101; id += 1) {
    overrides[`repos/${repository}/rulesets/${id}?includes_parents=true`] = JSON.stringify(
      rulesetDocument({ id }),
    );
  }
  const { calls, execFileImpl } = makeExecFile(overrides);

  const input = await collectWithGh({ repository, sha }, { execFileImpl });

  assert.equal(input.controlPlane.rulesets.length, 101);
  assert.equal(calls.includes(pageTwoEndpoint), true);
  assert.equal(
    input.collection.sources.some((item) => item.name === 'rulesets' && item.page === 2),
    true,
  );
});

test('paginates workflow runs by total_count and keeps both pages', async () => {
  const secondPath = '.github/workflows/secondary.yml';
  const treeEndpoint = `repos/${repository}/git/trees/${sha}?recursive=1`;
  const runPageOne = `repos/${repository}/actions/runs?head_sha=${sha}&per_page=100&page=1`;
  const runPageTwo = `repos/${repository}/actions/runs?head_sha=${sha}&per_page=100&page=2`;
  const overrides = {
    [treeEndpoint]: JSON.stringify({
      sha,
      truncated: false,
      tree: [
        { path: workflowPath, type: 'blob', sha: 'a'.repeat(40) },
        { path: secondPath, type: 'blob', sha: 'b'.repeat(40) },
      ],
    }),
    [`repos/${repository}/contents/${encodeURIComponent(secondPath)}?ref=${sha}`]: 'on: pull_request\njobs:\n  second:\n    name: second\n',
    [runPageOne]: JSON.stringify({ total_count: 2, workflow_runs: [runDocument()] }),
    [runPageTwo]: JSON.stringify({
      total_count: 2,
      workflow_runs: [runDocument({ id: 502, path: secondPath })],
    }),
    [`repos/${repository}/actions/runs/502/jobs?per_page=100&page=1`]: JSON.stringify({
      total_count: 1,
      jobs: [jobDocument({ id: 602, name: 'second' })],
    }),
    [`repos/${repository}/check-runs/602`]: JSON.stringify({
      id: 602,
      name: 'second',
      head_sha: sha,
      status: 'completed',
      conclusion: 'success',
      app: { id: 15368, slug: 'github-actions' },
    }),
  };
  const { calls, execFileImpl } = makeExecFile(overrides);

  const input = await collectWithGh({ repository, sha }, { execFileImpl });

  assert.equal(input.observedRuns.length, 2);
  assert.equal(calls.includes(runPageTwo), true);
  assert.deepEqual(input.observedRuns.map((run) => run.workflowPath), [workflowPath, secondPath]);
});

for (const status of ['queued', 'in_progress']) {
  test(`classifies a ${status} workflow run as lifecycle ambiguity`, async () => {
    const runEndpoint = `repos/${repository}/actions/runs?head_sha=${sha}&per_page=100&page=1`;
    const { execFileImpl } = makeExecFile({
      [runEndpoint]: JSON.stringify({
        total_count: 1,
        workflow_runs: [runDocument({ status, conclusion: null })],
      }),
    });

    const input = await collectWithGh({ repository, sha }, { execFileImpl });

    assert.equal(input.collection.complete, false);
    assert.equal(
      input.collection.sources.some((item) => item.reasonCode === 'RUN_LIFECYCLE_AMBIGUOUS'),
      true,
    );
  });
}

test('fails closed when no authoritative target ref can be resolved', async () => {
  const runEndpoint = `repos/${repository}/actions/runs?head_sha=${sha}&per_page=100&page=1`;
  const { execFileImpl } = makeExecFile({
    [runEndpoint]: JSON.stringify({
      total_count: 1,
      workflow_runs: [runDocument({ baseRef: null })],
    }),
  });

  const input = await collectWithGh({ repository, sha }, { execFileImpl });

  assert.equal(input.collection.complete, false);
  assert.equal(
    input.collection.sources.some((item) => item.reasonCode === 'TARGET_REF_UNRESOLVED'),
    true,
  );
});

test('makes classic-protection 404 incomplete instead of coexisting with complete=true', async () => {
  const endpoint = `repos/${repository}/branches/${targetRef}/protection`;
  const notFound = Object.assign(new Error('not found'), { code: 1, stderr: 'HTTP 404: Not Found' });
  const { execFileImpl } = makeExecFile({ [endpoint]: notFound });

  const input = await collectWithGh({ repository, sha }, { execFileImpl });

  assert.equal(input.controlPlane.classicProtection.state, 'unknown');
  assert.equal(input.collection.complete, false);
  assert.equal(
    input.collection.sources.some((item) => item.reasonCode === 'CLASSIC_PROTECTION_UNKNOWN'),
    true,
  );
});

test('rejects a non-allowlisted check-run URL before process invocation', async () => {
  const jobsEndpoint = `repos/${repository}/actions/runs/501/jobs?per_page=100&page=1`;
  const maliciousJob = {
    ...jobDocument(),
    check_run_url: `https://api.github.com/repos/${repository}/issues/1`,
  };
  const { calls, execFileImpl } = makeExecFile({
    [jobsEndpoint]: JSON.stringify({ total_count: 1, jobs: [maliciousJob] }),
  });

  const input = await collectWithGh({ repository, sha }, { execFileImpl });

  assert.equal(input.collection.complete, false);
  assert.equal(
    input.collection.sources.some((item) => item.reasonCode === 'ENDPOINT_NOT_ALLOWED'),
    true,
  );
  assert.equal(calls.some((endpoint) => endpoint.includes('/issues/')), false);
});

test('fails closed when a run page envelope contradicts total_count', async () => {
  const runEndpoint = `repos/${repository}/actions/runs?head_sha=${sha}&per_page=100&page=1`;
  const { execFileImpl } = makeExecFile({
    [runEndpoint]: JSON.stringify({ total_count: 2, workflow_runs: [] }),
  });

  const input = await collectWithGh({ repository, sha }, { execFileImpl });

  assert.equal(input.collection.complete, false);
  assert.equal(
    input.collection.sources.some((item) => item.reasonCode === 'GH_COLLECTION_FAILED'),
    true,
  );
});
