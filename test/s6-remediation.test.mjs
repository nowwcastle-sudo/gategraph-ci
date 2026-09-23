import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { auditControlPlane } from '../src/audit-control-plane.mjs';
import { loadFixtureEvidence } from './helpers/fixture-adapter.mjs';

const fixtureUrl = new URL('./fixtures/aggregate-omission/', import.meta.url);
const workflowPath = '.github/workflows/ci.yml';
const gateId = `${workflowPath}/check`;
const analysis = {
  analyzer: 'gategraph-ci',
  version: '0.2.0-experimental.2',
  contract: 'gategraph-audit/v1',
  analyzedAt: '2026-09-05T00:00:00.000Z',
};

async function fixtureInput() {
  const input = await loadFixtureEvidence(fixtureUrl);
  input.analysis = structuredClone(analysis);
  return input;
}

async function fullyCoveredAggregateInput() {
  const input = await fixtureInput();
  input.workflows[0].text = `on: pull_request
jobs:
  voting-test:
    name: Voting test
  unrelated-test:
    name: Unrelated test
  check:
    name: check
    needs: [voting-test, unrelated-test]
`;
  return input;
}

test('fails closed when a native required aggregate has needs but no exact gate policy', async () => {
  const input = await fullyCoveredAggregateInput();
  delete input.policy.gates;

  const report = await auditControlPlane(input);

  assert.equal(report.status, 'collection-error');
  assert.equal(report.results[0].reasonCode, 'UNSUPPORTED_OR_AMBIGUOUS_EVIDENCE');
  assert.deepEqual(report.results[0].unresolvedPremises, ['GATE_PROPAGATION_NOT_PROVEN']);
  assert.equal(report.results.some((result) => result.status === 'finding'), false);
});

test('uses exact all-needs policy as the only transitive aggregate-coverage proof', async () => {
  const input = await fullyCoveredAggregateInput();

  const report = await auditControlPlane(input);

  assert.equal(report.status, 'unknown');
  assert.equal(report.results[0].reasonCode, 'NO_UNCOVERED_PATH_PROVEN');
  assert.equal(report.results.some((result) => result.status === 'finding'), false);
});

test('supports a directly required producer gate without aggregate policy', async () => {
  const input = await fixtureInput();
  input.workflows[0].text = `on: pull_request
jobs:
  voting-test:
    name: Voting test
`;
  input.controlPlane.rulesets[0].requiredStatusChecks = [{
    context: 'Voting test',
    integrationId: 15368,
  }];
  input.observedRuns[0].checkRuns = [input.observedRuns[0].checkRuns[0]];
  input.policy.jobs = [{ workflowPath, jobId: 'voting-test', mergePolicy: 'voting' }];
  delete input.policy.gates;

  const report = await auditControlPlane(input);

  assert.equal(report.status, 'unknown');
  assert.equal(report.results[0].reasonCode, 'NO_UNCOVERED_PATH_PROVEN');
});

test('returns a generic parse report when valid YAML exceeds toJS alias limits', async () => {
  const input = await fixtureInput();
  const canary = 'WORKFLOW_ALIAS_CANARY_9f13';
  const aliases = Array.from({ length: 101 }, () => '  - *shared').join('\n');
  input.workflows[0].text = `on: pull_request
shared: &shared
  value: ${canary}
aliases:
${aliases}
jobs:
  voting-test:
    name: voting-test
`;

  const report = await auditControlPlane(input);
  const serialized = JSON.stringify(report);

  assert.equal(report.status, 'collection-error');
  assert.equal(report.results[0].reasonCode, 'WORKFLOW_PARSE_ERROR');
  assert.equal(report.results[0].message, 'Workflow YAML could not be parsed');
  assert.deepEqual(report.results[0].unresolvedPremises, ['WORKFLOW_DOCUMENT_CONVERSION_FAILED']);
  assert.equal(serialized.includes(canary), false);
  assert.equal(serialized.includes('alias'), false);
});

for (const [name, mutate] of [
  ['missing analysis metadata', (input) => { delete input.analysis; }],
  ['non-canonical analyzedAt', (input) => { input.analysis.analyzedAt = '2026-09-05T00:00:00+00:00'; }],
  ['unknown analyzer', (input) => { input.analysis.analyzer = 'other-analyzer'; }],
  ['unknown analyzer version', (input) => { input.analysis.version = '0.1.1'; }],
  ['unknown analysis contract', (input) => { input.analysis.contract = 'gategraph-audit/v2'; }],
]) {
  test(`fails canonical validation for ${name}`, async () => {
    const input = await fixtureInput();
    mutate(input);

    const report = await auditControlPlane(input);

    assert.equal(report.status, 'collection-error');
    assert.equal(report.results[0].reasonCode, 'EVIDENCE_INCOMPLETE');
    assert.deepEqual(report.results[0].unresolvedPremises, ['ANALYSIS_METADATA_INVALID']);
    assert.equal(report.results.some((result) => result.status === 'finding'), false);
  });
}

test('copies only exact allowlisted analysis provenance into a valid report', async () => {
  const report = await auditControlPlane(await fixtureInput());

  assert.deepEqual(
    {
      analyzer: report.provenance.analyzer,
      version: report.provenance.version,
      contract: report.provenance.contract,
      analyzedAt: report.provenance.analyzedAt,
    },
    analysis,
  );
});

test('replaces runtime-constructed token-shaped gate evidence with its 12-hex SHA-256 fingerprint', async () => {
  const input = await fixtureInput();
  const tokenShapedCanary = ['ghp', 'A'.repeat(36)].join('_');
  const fingerprint = createHash('sha256').update(tokenShapedCanary, 'utf8').digest('hex').slice(0, 12);
  input.policy.gates[gateId].evidence = tokenShapedCanary;

  const report = await auditControlPlane(input);
  const serialized = JSON.stringify(report);

  assert.equal(report.status, 'finding');
  assert.equal(serialized.includes(tokenShapedCanary), false);
  assert.deepEqual(report.provenance.gatePolicies, [{
    gateId,
    failurePropagation: 'all-needs',
    evidenceFingerprint: fingerprint,
  }]);
  assert.match(report.provenance.gatePolicies[0].evidenceFingerprint, /^[0-9a-f]{12}$/);
  assert.equal(Object.hasOwn(report.provenance.gatePolicies[0], 'evidence'), false);
});
