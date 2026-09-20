import assert from 'node:assert/strict';
import test from 'node:test';
import { auditControlPlane } from '../src/audit-control-plane.mjs';
import { loadFixtureEvidence } from './helpers/fixture-adapter.mjs';

const fixtureUrl = new URL('./fixtures/aggregate-omission/', import.meta.url);

test('reports an uncovered failure path when a required aggregate omits a voting job', async () => {
  const report = await auditControlPlane(await loadFixtureEvidence(fixtureUrl));

  assert.equal(report.status, 'finding');
  assert.equal(report.results.length, 1);
  assert.deepEqual(
    {
      status: report.results[0].status,
      kind: report.results[0].kind,
      severity: report.results[0].severity,
      evidenceState: report.results[0].evidenceState,
      producerJobId: report.results[0].producerJobId,
      aggregateJobId: report.results[0].aggregateJobId,
      requiredContext: report.results[0].requiredContext,
      failureScenario: report.results[0].failureScenario,
    },
    {
      status: 'finding',
      kind: 'uncovered-failure-path',
      severity: 'error',
      evidenceState: 'VERIFIED',
      producerJobId: 'voting-test',
      aggregateJobId: 'check',
      requiredContext: 'check',
      failureScenario: 'voting-test=failure while every dependency of check succeeds',
    },
  );
  assert.equal(report.results[0].reasonCode, 'UNCOVERED_BY_ALL_ACTIVE_GATES');
});
