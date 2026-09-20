import assert from 'node:assert/strict';
import test from 'node:test';
import { auditControlPlane } from '../src/audit-control-plane.mjs';
import { loadFixtureEvidence } from './helpers/fixture-adapter.mjs';

const fixtureUrl = new URL('./fixtures/aggregate-omission/', import.meta.url);

test('uses YAML 1.2 core so on remains a string workflow key', async () => {
  const input = await loadFixtureEvidence(fixtureUrl);
  const report = await auditControlPlane(input);

  assert.notEqual(report.status, 'collection-error');
});

test('checks doc.errors before toJS and reports malformed workflow text', async () => {
  const input = await loadFixtureEvidence(fixtureUrl);
  input.workflows[0].text = 'jobs:\n  broken: [unterminated';

  const report = await auditControlPlane(input);

  assert.equal(report.status, 'collection-error');
  assert.equal(report.results[0].reasonCode, 'WORKFLOW_PARSE_ERROR');
});
