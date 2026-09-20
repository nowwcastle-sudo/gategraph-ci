import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { auditControlPlane } from '../src/audit-control-plane.mjs';

const cases = JSON.parse(await readFile(new URL('./fixtures/audit/cases.json', import.meta.url), 'utf8'));
const expectedIds = [
  'CONTROL-HA-UNKNOWN',
  'CONTROL-UV-ADVISORY',
  'GG-01',
  'GG-02',
  'GG-03',
  'GG-04',
  'GG-05',
];

assert.equal(cases.length, 7);
assert.equal(cases.filter((item) => item.id.startsWith('GG-')).length, 5);
assert.deepEqual([...new Set(cases.map((item) => item.id))].sort(), expectedIds);

for (const auditCase of cases) {
  const { sourceCoordinate, input } = auditCase;
  assert.equal(input.subject.id, `${sourceCoordinate.repository}@${sourceCoordinate.sha}`);
  assert.equal(input.workflows.every((workflow) => workflow.sha === sourceCoordinate.sha), true);
  assert.equal(
    input.observedRuns.some((run) => (
      run.runId === sourceCoordinate.runId &&
      run.sha === sourceCoordinate.sha &&
      (sourceCoordinate.event === undefined || run.event === sourceCoordinate.event)
    )),
    true,
  );
  if (sourceCoordinate.rulesetId !== undefined) {
    assert.equal(
      input.controlPlane.rulesets.some((ruleset) => String(ruleset.id) === sourceCoordinate.rulesetId),
      true,
    );
  }
}

const reports = new Map();

for (const auditCase of cases) {
  test(`${auditCase.id} preserves its immutable audit classification`, async () => {
    const report = await auditControlPlane(structuredClone(auditCase.input));
    reports.set(auditCase.id, report);

    assert.equal(report.status, auditCase.expectedStatus);
    if (auditCase.expectedStatus === 'finding') {
      const expected = Array.isArray(auditCase.expectedReasonOrProducer)
        ? auditCase.expectedReasonOrProducer
        : [auditCase.expectedReasonOrProducer];
      assert.deepEqual(
        report.results.filter((result) => result.status === 'finding').map((result) => result.producerJobId),
        expected,
      );
    } else {
      assert.equal(
        report.results.some((result) => result.reasonCode === auditCase.expectedReasonOrProducer),
        true,
      );
    }
  });
}

test('both controls remain non-findings', () => {
  const reportsForControls = cases
    .filter((item) => item.id.startsWith('CONTROL-'))
    .map((item) => reports.get(item.id));

  assert.equal(reportsForControls.length, 2);
  assert.equal(reportsForControls.some((report) => report.status === 'finding'), false);
});
