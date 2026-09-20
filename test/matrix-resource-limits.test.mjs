import assert from 'node:assert/strict';
import test from 'node:test';
import { auditControlPlane } from '../src/audit-control-plane.mjs';
import { loadFixtureEvidence } from './helpers/fixture-adapter.mjs';

const fixtureUrl = new URL('./fixtures/aggregate-omission/', import.meta.url);
const expression = '${{ matrix.node }}';

async function auditWith(extraWorkflows) {
  const input = await loadFixtureEvidence(fixtureUrl);
  input.workflows.push(...extraWorkflows.map((text, index) => ({
    path: `.github/workflows/extra-${index}.yml`,
    sha: input.subject.sha,
    text: `on: pull_request\njobs:\n  test:\n    name: ${text}\n`,
  })));
  return auditControlPlane(input);
}

function assertLimit(report) {
  assert.equal(report.status, 'collection-error');
  assert.equal(report.results.length, 1);
  assert.equal(report.results[0].reasonCode, 'WORKFLOW_RESOURCE_LIMIT_EXCEEDED');
}

test('rejects a long job name in an unexecuted extra workflow', async () => {
  assertLimit(await auditWith(['x'.repeat(1025)]));
});

test('rejects a matrix cell count beyond the local limit', async () => {
  const values = Array.from({ length: 129 }, (_, index) => index).join(', ');
  const input = await loadFixtureEvidence(fixtureUrl);
  input.workflows[0].text += `\n  oversized:\n    name: test (${expression})\n    strategy:\n      matrix:\n        node: [${values}]\n`;
  assertLimit(await auditControlPlane(input));
});

test('rejects a workflow with too many jobs', async () => {
  const input = await loadFixtureEvidence(fixtureUrl);
  input.workflows[0].text += Array.from({ length: 126 }, (_, index) => (
    `\n  extra-${index}:\n    name: extra-${index}\n`
  )).join('');
  assertLimit(await auditControlPlane(input));
});

test('rejects a long matrix value before retaining expanded names', async () => {
  const input = await loadFixtureEvidence(fixtureUrl);
  input.workflows[0].text += `\n  oversized:\n    name: test (${expression})\n    strategy:\n      matrix:\n        node: ['${'x'.repeat(257)}']\n`;
  assertLimit(await auditControlPlane(input));
});

test('rejects prospective expansion before replace in an unexecuted workflow', async () => {
  const name = `test (${expression.repeat(9)})`;
  const input = await loadFixtureEvidence(fixtureUrl);
  input.workflows.push({
    path: '.github/workflows/unexecuted.yml',
    sha: input.subject.sha,
    text: `on: pull_request\njobs:\n  oversized:\n    name: ${name}\n    strategy:\n      matrix:\n        node: ['${'x'.repeat(256)}']\n`,
  });
  assertLimit(await auditControlPlane(input));
});

test('applies one expansion budget across multiple workflows', async () => {
  const values = Array.from({ length: 64 }, (_, index) => index).join(', ');
  const job = `    name: ${'x'.repeat(550)} (${expression})\n    strategy:\n      matrix:\n        node: [${values}]\n`;
  const input = await loadFixtureEvidence(fixtureUrl);
  input.workflows.push(...[1, 2].map((index) => ({
    path: `.github/workflows/matrix-${index}.yml`,
    sha: input.subject.sha,
    text: `on: pull_request\njobs:\n  matrix:\n${job}`,
  })));
  assertLimit(await auditControlPlane(input));
});

test('preserves ordered numeric and boolean matrix check names below the limits', async () => {
  const input = await loadFixtureEvidence(fixtureUrl);
  input.workflows[0].text = input.workflows[0].text.replace(
    'name: Voting test',
    `name: Voting test (${expression})\n    strategy:\n      matrix:\n        node: [20, true, false]`,
  );
  const original = input.observedRuns[0].checkRuns[0];
  input.observedRuns[0].checkRuns.splice(0, 1, ...['20', 'true', 'false'].map((value) => ({
    ...original,
    name: `Voting test (${value})`,
  })));
  input.controlPlane.rulesets[0].requiredStatusChecks.push({
    context: 'Voting test (20)',
    integrationId: 15368,
  });
  const report = await auditControlPlane(input);
  assert.equal(report.status, 'finding');
  assert.deepEqual(report.results.filter((result) => result.producer.jobId === 'voting-test')
    .map((result) => result.producerCheckName), [
    'Voting test (true)', 'Voting test (false)',
  ]);
});
