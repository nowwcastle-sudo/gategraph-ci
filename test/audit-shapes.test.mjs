import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDocument } from 'yaml';
import { auditControlPlane } from '../src/audit-control-plane.mjs';

const sha = '0123456789abcdef0123456789abcdef01234567';

function auditInput({ workflows, requiredStatusChecks, checkNames, jobs }) {
  const ref = 'refs/heads/main';
  const workflowPaths = workflows.map((text, index) => `workflow-${index}.yml`);
  const workflowTexts = workflows.map((text) => `on: pull_request\n${text}`);
  const checkNamesByWorkflow = Array.isArray(checkNames[0]) ? checkNames : [checkNames];
  const parsedJobs = workflowTexts.map((text) => parseDocument(text).toJS().jobs);
  const gatePolicies = {};
  parsedJobs.forEach((workflowJobs, workflowIndex) => {
    for (const [jobId, job] of Object.entries(workflowJobs)) {
      if (
        Object.hasOwn(job, 'needs') &&
        requiredStatusChecks.includes(job.name ?? jobId)
      ) {
        gatePolicies[`${workflowPaths[workflowIndex]}/${jobId}`] = {
          failurePropagation: 'all-needs',
          evidence: `audit-shapes-${workflowIndex}-${jobId}-v1`,
        };
      }
    }
  });
  return {
    analysis: {
      analyzer: 'gategraph-ci',
      version: '0.2.0-experimental.1',
      contract: 'gategraph-audit/v1',
      analyzedAt: '2026-09-05T00:00:00.000Z',
    },
    subject: {
      kind: 'fixture',
      id: 'audit-shapes',
      repository: 'fixture/audit-shapes',
      ref,
      defaultBranchRef: ref,
      sha,
    },
    workflows: workflowTexts.map((text, index) => ({ path: workflowPaths[index], sha, text })),
    controlPlane: {
      rulesets: [{
        id: 1,
        target: 'branch',
        enforcement: 'active',
        conditions: { refName: { include: [ref], exclude: [] } },
        requiredStatusChecks: requiredStatusChecks.map((context) => ({
          context,
          integrationId: 15368,
        })),
      }],
      classicProtection: { state: 'observed', targetRef: ref, requiredStatusChecks: [] },
    },
    observedRuns: workflowTexts.map((text, index) => ({
      event: 'pull_request',
      sha,
      runId: String(index + 1),
      workflowPath: workflowPaths[index],
      targetRef: ref,
      status: 'completed',
      conclusion: 'success',
      checkRuns: checkNamesByWorkflow[index].map((name) => ({
        name,
        sha,
        status: 'completed',
        conclusion: 'success',
        provider: { kind: 'github-app', integrationId: 15368 },
      })),
    })),
    policy: {
      jobs: Object.entries(jobs).map(([jobId, value]) => {
        const workflowIndex = parsedJobs.findIndex((workflowJobs) => Object.hasOwn(workflowJobs, jobId));
        return {
          workflowPath: workflowPaths[workflowIndex],
          jobId,
          mergePolicy: value.mergePolicy,
        };
      }),
      gates: gatePolicies,
    },
    collection: {
      complete: true,
      sources: [
        { name: 'workflow', outcome: 'observed', complete: true, sha },
        { name: 'control-plane', outcome: 'observed', complete: true, ref },
        { name: 'observed-runs', outcome: 'observed', complete: true, sha, pagesComplete: true },
        { name: 'policy', outcome: 'observed', complete: true },
      ],
    },
  };
}

for (const [modifier, value, matrixValues, observed] of [
  ['include', '[{node: 22}]', '[20, 24]', ['test (20)', 'test (22)', 'test (24)']],
  ['exclude', '[{node: 22}]', '[20, 22, 24]', ['test (20)', 'test (24)']],
]) {
  test(`fails closed when a matrix uses ${modifier}`, async () => {
    const report = await auditControlPlane(auditInput({
      workflows: [`jobs:\n  test:\n    name: test (\${{ matrix.node }})\n    strategy:\n      matrix:\n        node: ${matrixValues}\n        ${modifier}: ${value}\n`],
      requiredStatusChecks: ['test (20)', 'test (24)'],
      checkNames: observed,
      jobs: { test: { mergePolicy: 'voting' } },
    }));

    assert.equal(report.status, 'collection-error');
    assert.equal(report.results[0].reasonCode, 'UNSUPPORTED_OR_AMBIGUOUS_EVIDENCE');
  });
}

test('fails closed when a matrix has an unrepresented second axis', async () => {
  const report = await auditControlPlane(auditInput({
    workflows: ['jobs:\n  test:\n    name: test (${{ matrix.node }})\n    strategy:\n      matrix:\n        node: [20, 22, 24]\n        os: [ubuntu, windows]\n'],
    requiredStatusChecks: ['test (20)', 'test (24)'],
    checkNames: ['test (20)', 'test (22)', 'test (24)'],
    jobs: { test: { mergePolicy: 'voting' } },
  }));

  assert.equal(report.status, 'collection-error');
  assert.equal(report.results[0].reasonCode, 'UNSUPPORTED_OR_AMBIGUOUS_EVIDENCE');
});

test('preserves aggregate and direct matrix findings in one repository audit', async () => {
  const report = await auditControlPlane(auditInput({
    workflows: [
      'jobs:\n  covered:\n    name: covered\n  aggregate-producer:\n    name: aggregate producer\n  check:\n    name: check\n    needs: [covered]\n',
      'jobs:\n  build:\n    name: build\n  test:\n    name: test (${{ matrix.node }})\n    strategy:\n      matrix:\n        node: [20, 22, 24]\n',
    ],
    requiredStatusChecks: ['check', 'build', 'test (20)', 'test (24)'],
    checkNames: [
      ['covered', 'aggregate producer', 'check'],
      ['build', 'test (20)', 'test (22)', 'test (24)'],
    ],
    jobs: {
      'aggregate-producer': { mergePolicy: 'voting' },
      test: { mergePolicy: 'voting' },
    },
  }));

  assert.equal(report.status, 'finding');
  const producers = report.results
    .filter((result) => result.status === 'finding')
    .map((result) => result.producerJobId);
  assert.deepEqual(producers, ['aggregate-producer', 'test (22)']);
  assert.equal(new Set(producers).size, producers.length);
});

test('analyzes aggregate and directly required matrix contexts in the same workflow', async () => {
  const report = await auditControlPlane(auditInput({
    workflows: [
      'jobs:\n  covered:\n    name: covered\n  aggregate-producer:\n    name: aggregate producer\n  build:\n    name: build\n  test:\n    name: test (${{ matrix.node }})\n    strategy:\n      matrix:\n        node: [20, 22, 24]\n  check:\n    name: check\n    needs: [covered]\n',
    ],
    requiredStatusChecks: ['check', 'build', 'test (20)', 'test (24)'],
    checkNames: [[
      'covered',
      'aggregate producer',
      'build',
      'test (20)',
      'test (22)',
      'test (24)',
      'check',
    ]],
    jobs: {
      'aggregate-producer': { mergePolicy: 'voting' },
      test: { mergePolicy: 'voting' },
    },
  }));

  assert.equal(report.status, 'finding');
  assert.deepEqual(
    report.results.map((result) => ({
      status: result.status,
      reasonCode: result.reasonCode ?? null,
      producerJobId: result.producerJobId,
      aggregateJobId: result.aggregateJobId ?? null,
      requiredContext: result.requiredContext,
    })),
    [
      {
        status: 'finding',
        reasonCode: 'UNCOVERED_BY_ALL_ACTIVE_GATES',
        producerJobId: 'aggregate-producer',
        aggregateJobId: null,
        requiredContext: undefined,
      },
      {
        status: 'finding',
        reasonCode: 'UNCOVERED_BY_ALL_ACTIVE_GATES',
        producerJobId: 'test (22)',
        aggregateJobId: null,
        requiredContext: undefined,
      },
    ],
  );
  assert.deepEqual(
    report.results.map((result) => result.requiredContexts),
    [
      ['check', 'build', 'test (20)', 'test (24)'],
      ['check', 'build', 'test (20)', 'test (24)'],
    ],
  );
  assert.equal(report.results.some((result) => result.status === 'policy-review'), false);
  assert.equal(
    report.results.some((result) => (
      result.aggregateJobId === 'check' && ['build', 'test'].includes(result.producerJobId)
    )),
    false,
  );
});
