import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDocument } from 'yaml';
import { auditControlPlane } from '../src/audit-control-plane.mjs';

const repository = 'example/project';
const sha = '0123456789abcdef0123456789abcdef01234567';
const ref = 'refs/heads/main';
const workflowPath = '.github/workflows/ci.yml';
const provider = { kind: 'github-app', integrationId: 15368 };

function source(name, extra = {}) {
  return { name, outcome: 'observed', complete: true, ...extra };
}

function ruleset(contexts = ['gate'], overrides = {}) {
  return {
    id: 91,
    target: 'branch',
    enforcement: 'active',
    conditions: { refName: { include: [ref], exclude: [] } },
    requiredStatusChecks: contexts.map((context) => ({ context, integrationId: 15368 })),
    ...overrides,
  };
}

function checkRun(name, overrides = {}) {
  return {
    name,
    sha,
    status: 'completed',
    conclusion: 'success',
    provider,
    ...overrides,
  };
}

function makeInput({
  workflowText = `on: pull_request
jobs:
  producer:
    name: producer
    runs-on: ubuntu-latest
    steps: []
  dependency:
    name: dependency
    runs-on: ubuntu-latest
    steps: []
  gate:
    name: gate
    needs: [dependency]
    runs-on: ubuntu-latest
    steps: []
`,
  workflowSha = sha,
  runSha = sha,
  subject = {},
  rulesets = [ruleset()],
  classicProtection = {
    state: 'observed',
    targetRef: ref,
    requiredStatusChecks: [],
  },
  checkRuns = ['producer', 'dependency', 'gate'].map((name) => checkRun(name)),
  policyJobs = [{ workflowPath, jobId: 'producer', mergePolicy: 'voting' }],
  policyGates,
  sources = [
    source('workflow', { path: workflowPath, sha }),
    source('control-plane', { ref }),
    source('observed-runs', { runId: '501', sha, pagesComplete: true }),
    source('policy'),
  ],
  collectionComplete = true,
  run = {},
} = {}) {
  let inferredGatePolicies = {};
  if (policyGates === undefined) {
    try {
      const doc = parseDocument(workflowText);
      const value = doc.errors.length === 0 ? doc.toJS() : null;
      const requiredContexts = new Set([
        ...rulesets.flatMap((item) => item.requiredStatusChecks ?? []).map((item) => item.context),
        ...(classicProtection.requiredStatusChecks ?? []).map((item) => item.context),
      ]);
      for (const [jobId, job] of Object.entries(value?.jobs ?? {})) {
        if (Object.hasOwn(job, 'needs') && requiredContexts.has(job.name ?? jobId)) {
          inferredGatePolicies[`${workflowPath}/${jobId}`] = {
            failurePropagation: 'all-needs',
            evidence: `final-review-core-${jobId}-v1`,
          };
        }
      }
    } catch {
      inferredGatePolicies = {};
    }
  }
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
      ...subject,
    },
    workflows: [{ path: workflowPath, sha: workflowSha, text: workflowText }],
    controlPlane: { rulesets, classicProtection },
    observedRuns: [{
      event: 'pull_request',
      sha: runSha,
      runId: '501',
      workflowPath,
      targetRef: ref,
      status: 'completed',
      conclusion: 'success',
      checkRuns,
      ...run,
    }],
    policy: { jobs: policyJobs, gates: policyGates ?? inferredGatePolicies },
    collection: { complete: collectionComplete, sources },
  };
}

test('proves a voting producer is uncovered only when every active gate bypasses it', async () => {
  const report = await auditControlPlane(makeInput());

  assert.equal(report.status, 'finding');
  assert.equal(report.results[0].reasonCode, 'UNCOVERED_BY_ALL_ACTIVE_GATES');
  assert.equal(report.results[0].producerJobId, 'producer');
  assert.deepEqual(report.results[0].requiredContexts, ['gate']);
});

test('treats a producer as covered through a transitive dependency path', async () => {
  const input = makeInput({
    workflowText: `on: pull_request
jobs:
  producer:
    name: producer
  middle:
    name: middle
    needs: [producer]
  gate:
    name: gate
    needs: [middle]
`,
    checkRuns: ['producer', 'middle', 'gate'].map((name) => checkRun(name)),
  });

  const report = await auditControlPlane(input);

  assert.equal(report.status, 'unknown');
  assert.equal(report.results.some((result) => result.status === 'finding'), false);
  assert.equal(report.results[0].reasonCode, 'NO_UNCOVERED_PATH_PROVEN');
});

test('does not report a producer when either of two active gates covers it', async () => {
  const input = makeInput({
    workflowText: `on: pull_request
jobs:
  producer:
    name: producer
  gate-one:
    name: gate-one
  gate-two:
    name: gate-two
    needs: [producer]
`,
    rulesets: [ruleset(['gate-one', 'gate-two'])],
    checkRuns: ['producer', 'gate-one', 'gate-two'].map((name) => checkRun(name)),
  });

  const report = await auditControlPlane(input);

  assert.equal(report.status, 'unknown');
  assert.equal(report.results.some((result) => result.status === 'finding'), false);
});

test('never verifies a finding when no active applicable gate exists', async () => {
  const input = makeInput({
    rulesets: [ruleset(['gate'], { enforcement: 'disabled' })],
  });

  const report = await auditControlPlane(input);

  assert.equal(report.status, 'collection-error');
  assert.equal(report.results[0].reasonCode, 'NO_ACTIVE_REQUIRED_GATE');
  assert.equal(report.results.some((result) => result.status === 'finding'), false);
});

for (const [name, mutate] of [
  ['missing subject identity', (input) => { input.subject.id = ''; }],
  ['invalid GitHub SHA', (input) => { input.subject.sha = input.subject.sha.slice(1); }],
  ['workflow SHA mismatch', (input) => { input.workflows[0].sha = 'f'.repeat(40); }],
  ['run SHA mismatch', (input) => { input.observedRuns[0].sha = 'f'.repeat(40); }],
  ['check-run SHA mismatch', (input) => { input.observedRuns[0].checkRuns[0].sha = 'f'.repeat(40); }],
  ['run target mismatch', (input) => { input.observedRuns[0].targetRef = 'refs/heads/other'; }],
  ['malformed required context', (input) => {
    input.controlPlane.rulesets[0].requiredStatusChecks = [{ context: '', integrationId: 15368 }];
  }],
]) {
  test(`canonical coordinate gate rejects ${name}`, async () => {
    const input = makeInput();
    mutate(input);

    const report = await auditControlPlane(input);

    assert.equal(report.status, 'collection-error');
    assert.equal(report.results.some((result) => result.status === 'finding'), false);
  });
}

for (const [name, sources] of [
  ['empty sources', []],
  ['unknown source outcome', [source('workflow'), { name: 'control-plane', outcome: 'unknown', complete: true }]],
  ['incomplete page evidence', [source('workflow'), source('control-plane'), source('observed-runs', { pagesComplete: false })]],
  ['missing source name', [{ name: '', outcome: 'observed', complete: true }]],
]) {
  test(`canonical completeness gate rejects ${name}`, async () => {
    const report = await auditControlPlane(makeInput({ sources }));

    assert.equal(report.status, 'collection-error');
    assert.equal(report.results.some((result) => result.status === 'finding'), false);
  });
}

test('canonical provenance gate rejects a source SHA from another coordinate', async () => {
  const input = makeInput();
  input.collection.sources[0].sha = 'f'.repeat(40);

  const report = await auditControlPlane(input);

  assert.equal(report.status, 'collection-error');
  assert.equal(report.results[0].reasonCode, 'EVIDENCE_INCOMPLETE');
});

test('canonical provenance gate never echoes a non-allowlisted source endpoint', async () => {
  const canary = 'SOURCE_ENDPOINT_CANARY_9f13';
  const input = makeInput();
  input.collection.sources[0].endpoint = canary;

  const report = await auditControlPlane(input);

  assert.equal(report.status, 'collection-error');
  assert.equal(JSON.stringify(report).includes(canary), false);
});

test('canonical completeness gate requires workflow, control-plane, run, and policy sources', async () => {
  const input = makeInput({
    sources: [source('policy')],
  });

  const report = await auditControlPlane(input);

  assert.equal(report.status, 'collection-error');
  assert.equal(report.results[0].reasonCode, 'EVIDENCE_INCOMPLETE');
});

test('canonical completeness gate rejects page counts that do not reach total_count', async () => {
  const input = makeInput();
  input.collection.sources[2] = source('observed-runs', {
    runId: '501',
    sha,
    page: 1,
    count: 1,
    totalCount: 2,
    pagesComplete: true,
  });

  const report = await auditControlPlane(input);

  assert.equal(report.status, 'collection-error');
  assert.equal(report.results[0].reasonCode, 'EVIDENCE_INCOMPLETE');
});

test('normalizes classic-only required protection into the active-gate model', async () => {
  const input = makeInput({
    rulesets: [],
    classicProtection: {
      state: 'observed',
      targetRef: ref,
      requiredStatusChecks: [{ context: 'gate', integrationId: 15368 }],
    },
  });

  const report = await auditControlPlane(input);

  assert.equal(report.status, 'finding');
  assert.equal(report.results[0].reasonCode, 'UNCOVERED_BY_ALL_ACTIVE_GATES');
  assert.deepEqual(report.results[0].requiredContexts, ['gate']);
});

test('fails closed when classic protection is unresolved', async () => {
  const input = makeInput({
    classicProtection: { state: 'unknown', reasonCode: 'CLASSIC_PROTECTION_UNKNOWN' },
  });

  const report = await auditControlPlane(input);

  assert.equal(report.status, 'collection-error');
  assert.equal(report.results[0].reasonCode, 'CLASSIC_PROTECTION_UNKNOWN');
});

test('rejects rulesets whose branch conditions do not apply to the target ref', async () => {
  const input = makeInput({
    rulesets: [ruleset(['gate'], {
      conditions: { refName: { include: ['refs/heads/release'], exclude: [] } },
    })],
  });

  const report = await auditControlPlane(input);

  assert.equal(report.status, 'collection-error');
  assert.equal(report.results[0].reasonCode, 'NO_ACTIVE_REQUIRED_GATE');
});

test('rejects a provider-bound gate when the observed provider does not match', async () => {
  const input = makeInput({
    checkRuns: [
      checkRun('producer'),
      checkRun('dependency'),
      checkRun('gate', { provider: { kind: 'github-app', integrationId: 999 } }),
    ],
  });

  const report = await auditControlPlane(input);

  assert.equal(report.status, 'collection-error');
  assert.equal(report.results[0].reasonCode, 'UNSUPPORTED_OR_AMBIGUOUS_EVIDENCE');
});

test('rejects duplicate check names emitted by different job identities', async () => {
  const input = makeInput({
    workflowText: `on: pull_request
jobs:
  one:
    name: duplicate
  two:
    name: duplicate
  gate:
    name: gate
`,
    checkRuns: [checkRun('duplicate'), checkRun('gate')],
    policyJobs: [{ workflowPath, jobId: 'one', mergePolicy: 'voting' }],
  });

  const report = await auditControlPlane(input);

  assert.equal(report.status, 'collection-error');
  assert.equal(report.results[0].reasonCode, 'UNSUPPORTED_OR_AMBIGUOUS_EVIDENCE');
});

test('rejects duplicate workflow/job policy identities', async () => {
  const duplicate = { workflowPath, jobId: 'producer', mergePolicy: 'voting' };
  const input = makeInput({ policyJobs: [duplicate, { ...duplicate }] });

  const report = await auditControlPlane(input);

  assert.equal(report.status, 'collection-error');
  assert.equal(report.results[0].reasonCode, 'UNSUPPORTED_OR_AMBIGUOUS_EVIDENCE');
});

test('contains malformed YAML canaries behind a generic parse error', async () => {
  const canary = 'WORKFLOW_PARSE_CANARY_9f13';
  const input = makeInput({
    workflowText: `jobs:\n  ${canary}: [unterminated`,
  });

  const report = await auditControlPlane(input);
  const serialized = JSON.stringify(report);

  assert.equal(report.status, 'collection-error');
  assert.equal(report.results[0].reasonCode, 'WORKFLOW_PARSE_ERROR');
  assert.equal(report.results[0].message, 'Workflow YAML could not be parsed');
  assert.equal(serialized.includes(canary), false);
  if (report.results[0].location !== undefined) {
    assert.equal(Number.isInteger(report.results[0].location.line), true);
    assert.equal(Number.isInteger(report.results[0].location.column), true);
  }
});

for (const [name, jobFragment] of [
  ['continue-on-error', 'continue-on-error: true\n    runs-on: ubuntu-latest'],
  ['conditional producer', 'if: success()\n    runs-on: ubuntu-latest'],
  ['reusable job', 'uses: example/repository/.github/workflows/reusable.yml@main'],
]) {
  test(`rejects unsupported ${name} semantics`, async () => {
    const input = makeInput({
      workflowText: `on: pull_request
jobs:
  producer:
    name: producer
    ${jobFragment}
  dependency:
    name: dependency
  gate:
    name: gate
    needs: [dependency]
`,
    });

    const report = await auditControlPlane(input);

    assert.equal(report.status, 'collection-error');
    assert.equal(report.results[0].reasonCode, 'UNSUPPORTED_OR_AMBIGUOUS_EVIDENCE');
  });
}

test('supports policy-backed always() only on an active aggregate gate', async () => {
  const input = makeInput({
    workflowText: `on: pull_request
jobs:
  producer:
    name: producer
  dependency:
    name: dependency
  gate:
    name: gate
    if: always()
    needs: [dependency]
`,
    policyGates: {
      [`${workflowPath}/gate`]: {
        failurePropagation: 'all-needs',
        evidence: 'final-review-core-gate-v1',
      },
    },
  });

  const report = await auditControlPlane(input);

  assert.equal(report.status, 'finding');
  assert.equal(report.results[0].producerJobId, 'producer');
});

for (const [name, workflowText] of [
  ['missing dependency', `on: pull_request
jobs:
  producer:
    name: producer
  gate:
    name: gate
    needs: [missing]
`],
  ['dependency cycle', `on: pull_request
jobs:
  producer:
    name: producer
  one:
    name: one
    needs: [two]
  two:
    name: two
    needs: [one]
  gate:
    name: gate
    needs: [one]
`],
]) {
  test(`rejects a ${name} in the workflow DAG`, async () => {
    const names = name === 'missing dependency'
      ? ['producer', 'gate']
      : ['producer', 'one', 'two', 'gate'];
    const report = await auditControlPlane(makeInput({
      workflowText,
      checkRuns: names.map((checkName) => checkRun(checkName)),
    }));

    assert.equal(report.status, 'collection-error');
    assert.equal(report.results[0].reasonCode, 'UNSUPPORTED_OR_AMBIGUOUS_EVIDENCE');
  });
}

test('reports an uncovered matrix instance against active contexts, never against itself', async () => {
  const input = makeInput({
    workflowText: `on: pull_request
jobs:
  build:
    name: build
  test:
    name: test (\${{ matrix.node }})
    strategy:
      matrix:
        node: [20, 22, 24]
`,
    rulesets: [ruleset(['build', 'test (20)', 'test (24)'])],
    checkRuns: ['build', 'test (20)', 'test (22)', 'test (24)'].map((name) => checkRun(name)),
    policyJobs: [{ workflowPath, jobId: 'test', mergePolicy: 'voting' }],
  });

  const report = await auditControlPlane(input);

  assert.equal(report.status, 'finding');
  assert.equal(report.results[0].producerJobId, 'test (22)');
  assert.deepEqual(report.results[0].requiredContexts, ['build', 'test (20)', 'test (24)']);
  assert.equal(report.results[0].requiredContexts.includes('test (22)'), false);
});

test('preserves immutable safe provenance and stable finding explanation', async () => {
  const report = await auditControlPlane(makeInput());
  const serialized = JSON.stringify(report);

  assert.deepEqual(report.subject, {
    kind: 'github',
    id: `${repository}@${sha}`,
    repository,
    ref,
    sha,
  });
  assert.equal(report.results[0].reasonCode, 'UNCOVERED_BY_ALL_ACTIVE_GATES');
  assert.equal(typeof report.results[0].message, 'string');
  assert.deepEqual(report.results[0].evidenceCoordinates, {
    sha,
    ref,
    workflowPath,
    runIds: ['501'],
  });
  assert.equal(report.results[0].unresolvedPremises.length, 0);
  assert.equal(report.provenance.sources.some((item) => item.path === workflowPath), true);
  assert.equal(serialized.includes('steps'), false);
});
