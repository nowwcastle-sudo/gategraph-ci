import assert from 'node:assert/strict';
import test from 'node:test';
import { auditControlPlane } from '../src/audit-control-plane.mjs';
import { loadFixtureEvidence } from './helpers/fixture-adapter.mjs';

const fixtureUrl = new URL('./fixtures/aggregate-omission/', import.meta.url);

test('keeps an explicitly advisory omission out of findings', async () => {
  const input = structuredClone(await loadFixtureEvidence(fixtureUrl));
  input.policy.jobs.find((job) => job.jobId === 'voting-test').mergePolicy = 'advisory';

  const report = await auditControlPlane(input);

  assert.equal(report.status, 'unknown');
  assert.equal(report.results[0].reasonCode, 'EXPLICIT_ADVISORY');
  assert.equal(report.results.some((result) => result.status === 'finding'), false);
});

test('requests policy review when voting intent is absent', async () => {
  const input = structuredClone(await loadFixtureEvidence(fixtureUrl));
  input.policy.jobs = input.policy.jobs.filter((job) => job.jobId !== 'voting-test');

  const report = await auditControlPlane(input);

  assert.equal(report.status, 'policy-review');
  assert.equal(report.results[0].reasonCode, 'VOTING_INTENT_UNKNOWN');
});

test('returns collection-error when required collection is incomplete', async () => {
  const input = structuredClone(await loadFixtureEvidence(fixtureUrl));
  input.collection.complete = false;
  input.collection.sources = [{ name: 'check-runs', outcome: 'truncated' }];

  const report = await auditControlPlane(input);

  assert.equal(report.status, 'collection-error');
  assert.equal(report.results[0].reasonCode, 'EVIDENCE_INCOMPLETE');
});

test('fails closed when a ruleset member is malformed', async () => {
  const input = structuredClone(await loadFixtureEvidence(fixtureUrl));
  input.controlPlane.rulesets = [null];

  const report = await auditControlPlane(input);

  assert.equal(report.status, 'collection-error');
  assert.equal(report.results[0].reasonCode, 'EVIDENCE_INCOMPLETE');
});

test('fails closed when a check-run member is malformed', async () => {
  const input = structuredClone(await loadFixtureEvidence(fixtureUrl));
  input.observedRuns[0].checkRuns = [null];

  const report = await auditControlPlane(input);

  assert.equal(report.status, 'collection-error');
  assert.equal(report.results[0].reasonCode, 'EVIDENCE_INCOMPLETE');
});

test('does not disclose unrelated secret markers or execute workflow text', async () => {
  const input = structuredClone(await loadFixtureEvidence(fixtureUrl));
  input.syntheticSecret = 'GATEGRAPH_SECRET_CANARY_9f13';
  input.workflows[0].text += '\n# never execute: New-Item GATEGRAPH_CANARY_FILE\n';

  const report = await auditControlPlane(input);

  assert.equal(JSON.stringify(report).includes('GATEGRAPH_SECRET_CANARY_9f13'), false);
  assert.equal(report.subject.id, 'aggregate-omission');
  assert.deepEqual(
    report.provenance.sources.map((source) => source.name),
    ['workflow', 'ruleset', 'check-runs', 'policy'],
  );
});

test('limits object provenance to collection source outcomes', async () => {
  const input = structuredClone(await loadFixtureEvidence(fixtureUrl));
  input.collection.sources = [{
    name: 'workflow',
    outcome: 'complete',
    syntheticSecret: 'GATEGRAPH_SECRET_CANARY_9f13',
  }];

  const report = await auditControlPlane(input);

  assert.deepEqual(report.provenance.sources, [{ name: 'workflow', outcome: 'complete' }]);
  assert.equal(JSON.stringify(report).includes('GATEGRAPH_SECRET_CANARY_9f13'), false);
});
