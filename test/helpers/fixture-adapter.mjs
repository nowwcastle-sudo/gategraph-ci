import { readFile } from 'node:fs/promises';

async function readText(name, fixtureUrl) {
  return readFile(new URL(name, fixtureUrl), 'utf8');
}

async function readJson(name, fixtureUrl) {
  return JSON.parse(await readText(name, fixtureUrl));
}

export async function loadFixtureEvidence(fixtureUrl) {
  const sha = 'fixture:aggregate-omission';
  const ref = 'refs/heads/main';
  const workflowPath = '.github/workflows/ci.yml';
  const ruleset = await readJson('ruleset.json', fixtureUrl);
  const checks = await readJson('check-runs.json', fixtureUrl);
  const policy = await readJson('policy.json', fixtureUrl);
  return {
    analysis: {
      analyzer: 'gategraph-ci',
      version: '0.2.0-experimental.2',
      contract: 'gategraph-audit/v1',
      analyzedAt: '2026-09-05T00:00:00.000Z',
    },
    subject: {
      kind: 'fixture',
      id: 'aggregate-omission',
      repository: 'fixture/aggregate-omission',
      ref,
      defaultBranchRef: ref,
      sha,
    },
    workflows: [{
      path: workflowPath,
      sha,
      text: await readText('workflow.yml', fixtureUrl),
    }],
    controlPlane: {
      rulesets: [{
        id: 1,
        target: 'branch',
        enforcement: ruleset.enforcement,
        conditions: { refName: { include: [ref], exclude: [] } },
        requiredStatusChecks: ruleset.requiredStatusChecks.map((context) => ({
          context,
          integrationId: 15368,
        })),
      }],
      classicProtection: { state: 'observed', targetRef: ref, requiredStatusChecks: [] },
    },
    observedRuns: [{
      event: 'pull_request',
      sha,
      runId: 'fixture-run',
      workflowPath,
      targetRef: ref,
      status: 'completed',
      conclusion: 'success',
      checkRuns: checks.map((check) => ({
        ...check,
        sha,
        provider: { kind: 'github-app', integrationId: 15368 },
      })),
    }],
    policy: {
      jobs: Object.entries(policy.jobs).map(([jobId, value]) => ({
        workflowPath,
        jobId,
        mergePolicy: value.mergePolicy,
      })),
      gates: structuredClone(policy.gates),
    },
    collection: {
      complete: true,
      sources: [
        { name: 'workflow', outcome: 'observed', complete: true, path: workflowPath, sha },
        { name: 'ruleset', outcome: 'observed', complete: true, rulesetId: '1', ref },
        { name: 'check-runs', outcome: 'observed', complete: true, runId: 'fixture-run', sha },
        { name: 'policy', outcome: 'observed', complete: true },
      ],
    },
  };
}
