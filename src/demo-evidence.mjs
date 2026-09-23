export const DEMO_SCENARIOS = Object.freeze([
  'finding', 'policy-review', 'unknown', 'collection-error',
]);

/** Build fresh synthetic evidence without filesystem or network access. */
export function createDemoInput(scenario = 'finding') {
  if (!DEMO_SCENARIOS.includes(scenario)) throw new TypeError('unsupported demo scenario');
  const path = '.github/workflows/demo.yml';
  const sha = 'fixture:gategraph-synthetic-demo-v1';
  const ref = 'refs/heads/main';
  const runId = 'synthetic-demo-run';
  const complete = scenario !== 'collection-error';
  return {
    analysis: {
      analyzer: 'gategraph-ci', version: '0.2.0-experimental.2',
      contract: 'gategraph-audit/v1', analyzedAt: '2026-09-05T00:00:00.000Z',
    },
    subject: {
      kind: 'fixture', id: `synthetic-demo-${scenario}`,
      repository: 'fixture/synthetic-demo', sha, ref, defaultBranchRef: ref,
    },
    workflows: [{ path, sha, text: [
      'on: pull_request', 'jobs:', '  producer:', '    name: producer',
      '  dependency:', '    name: dependency', '  gate:', '    name: gate',
      '    if: always()', '    needs: [dependency]', '',
    ].join('\n') }],
    controlPlane: {
      rulesets: [{
        id: 1, target: 'branch', enforcement: 'active',
        conditions: { refName: { include: [ref], exclude: [] } },
        requiredStatusChecks: [{ context: 'gate', integrationId: 15368 }],
      }],
      classicProtection: { state: 'observed', targetRef: ref, requiredStatusChecks: [] },
    },
    observedRuns: [{
      runId, workflowPath: path, event: 'pull_request', sha,
      targetRef: ref, status: 'completed', conclusion: 'success',
      checkRuns: ['producer', 'dependency', 'gate'].map((name) => ({
        name, sha, status: 'completed', conclusion: 'success',
        provider: { kind: 'github-app', integrationId: 15368 },
      })),
    }],
    policy: {
      jobs: [
        ...(scenario === 'policy-review' ? [] : [{
          workflowPath: path, jobId: 'producer',
          mergePolicy: scenario === 'unknown' ? 'advisory' : 'voting',
        }]),
        { workflowPath: path, jobId: 'dependency', mergePolicy: 'voting' },
      ],
      gates: { [`${path}/gate`]: {
        failurePropagation: 'all-needs', evidence: 'synthetic-demo-gate-policy-v1',
      } },
    },
    collection: { complete, sources: [
      { name: 'workflow', outcome: complete ? 'observed' : 'incomplete', complete, path, sha },
      { name: 'ruleset', outcome: 'observed', complete: true, rulesetId: '1', ref },
      { name: 'check-runs', outcome: 'observed', complete: true, runId, sha },
      { name: 'policy', outcome: 'observed', complete: true },
    ] },
  };
}
