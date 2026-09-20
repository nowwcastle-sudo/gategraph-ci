import test from 'node:test';
import assert from 'node:assert/strict';
import { expandStaticMatrix } from '../src/static-matrix.mjs';
import { auditControlPlane } from '../src/audit-control-plane.mjs';
import { createDemoInput } from '../src/demo-evidence.mjs';

const limits = { maxValues: 128, maxValueLength: 256, maxNameLength: 1024, maxExpandedChars: 65536 };
const expand = (name, matrix, budget = { expandedChars: 0 }) => expandStaticMatrix(
  { name, strategy: { matrix } }, limits, budget,
);

test('all axes participate in unique literal names in sorted identity order', () => {
  const result = expand('test (${{ matrix.os }}, ${{ matrix.node }})', { os: ['win', 'linux'], node: [22, 24] });
  assert.equal(result.cells.length, 4);
  assert.deepEqual(result.cells[0], { axes: { node: 22, os: 'win' }, checkName: 'test (win, 22)' });
  assert.deepEqual(result.cells.map((cell) => cell.checkName), [
    'test (win, 22)', 'test (linux, 22)', 'test (win, 24)', 'test (linux, 24)',
  ]);
});

test('stringified scalar and duplicate values cannot identify separate cells', () => {
  assert.equal(expand('${{ matrix.x }}-${{ matrix.y }}', { x: [1, '1'], y: ['a'] }).error, 'unsupported');
  assert.equal(expand('${{ matrix.x }}', { x: ['a', 'a'] }).error, 'unsupported');
});

test('limits cell product at 128, not just each axis', () => {
  assert.equal(expand('${{ matrix.x }}-${{ matrix.y }}', { x: Array.from({ length: 64 }, (_, i) => i), y: [true, false] }).cells.length, 128);
  const budget = { expandedChars: 17 };
  assert.equal(expand('${{ matrix.x }}-${{ matrix.y }}', { x: Array.from({ length: 43 }, (_, i) => i), y: [1, 2, 3] }, budget).error, 'resource-limit');
  assert.equal(budget.expandedChars, 17);
  assert.equal(expand('${{ matrix.x }}-${{ matrix.y }}-${{ matrix.z }}-${{ matrix.w }}-${{ matrix.v }}', {
    x: [1], y: [2], z: [3], w: [4], v: [5],
  }).error, 'resource-limit');
});

test('repeated tokens expand but omitted, dynamic, and include/exclude axes reject', () => {
  assert.equal(expand('${{ matrix.x }}:${{matrix.x}}:${{ matrix.y }}', { x: [1], y: [false] }).cells[0].checkName, '1:1:false');
  for (const [name, matrix] of [
    ['${{ matrix.x }}', { x: [1], y: [2] }],
    ['${{ matrix.x }}-${{ matrix.y }}', { x: [1], y: ['${{ github.ref }}'] }],
    ['${{ matrix.x }}', { x: [1], include: [{ x: 2 }] }],
    ['${{ matrix.x }}', { x: [1], exclude: [{ x: 1 }] }],
    ['${{ matrix.x }}', { x: [null] }],
    ['${{ matrix.x }}', { x: [{}] }],
    ['${{ matrix.x }}', { x: [] }],
    ['${{ matrix.x }}', { x: [NaN] }],
    ['${{ matrix.x }}', { x: [Infinity] }],
  ]) {
    const budget = { expandedChars: 11 };
    assert.equal(expand(name, matrix, budget).error, 'unsupported');
    assert.equal(budget.expandedChars, 11);
  }
});

test('rejects oversized values and expanded strings without consuming budget', () => {
  const budget = { expandedChars: 5 };
  assert.equal(expand('${{ matrix.x }}', { x: ['x'.repeat(257)] }, budget).error, 'resource-limit');
  assert.equal(expand('p' + '${{ matrix.x }}'.repeat(8), { x: ['x'.repeat(256)] }, budget).error, 'resource-limit');
  assert.equal(expand('${{ matrix.x }}', { x: ['x'.repeat(256)] }, { expandedChars: 65536 }).error, 'resource-limit');
  assert.equal(budget.expandedChars, 5);
});

test('literal no-strategy name and finite scalar values preserve original checks', () => {
  const budget = { expandedChars: 0 };
  assert.deepEqual(expandStaticMatrix({ name: 'literal' }, limits, budget), { cells: [{ axes: {}, checkName: 'literal' }] });
  assert.equal(budget.expandedChars, 7);
  assert.deepEqual(expand('${{ matrix.x }}', { x: [20, true, false, -1.5] }).cells.map((cell) => cell.checkName), ['20', 'true', 'false', '-1.5']);
});

function matrixDemo(axes) {
  const input = createDemoInput('finding');
  const names = Object.keys(axes);
  const template = names.map((name) => '${{ matrix.' + name + ' }}').join('-');
  const matrix = names.map((name) => `        ${name}: [${axes[name].join(', ')}]`).join('\n');
  input.workflows[0].text = input.workflows[0].text.replace('    name: producer', `    name: producer (${template})\n    strategy:\n      matrix:\n${matrix}`);
  let suffixes = [''];
  for (const name of names) suffixes = suffixes.flatMap((prefix) => axes[name].map((value) => prefix ? `${prefix}-${value}` : String(value)));
  const observed = input.observedRuns[0].checkRuns.shift();
  input.observedRuns[0].checkRuns.unshift(...suffixes.map((suffix) => ({ ...observed, name: `producer (${suffix})` })));
  return input;
}

test('audit joins 2, 3, and 4-axis cells individually without changing finding semantics', async () => {
  for (const axes of [{ a: [1, 2], b: [3, 4] }, { a: [1, 2], b: [3], c: [4] }, { a: [1], b: [2], c: [3], d: [4] }]) {
    const input = matrixDemo(axes);
    const report = await auditControlPlane(input);
    assert.equal(report.status, 'finding');
    assert.deepEqual(report.results.filter((item) => item.producer.jobId === 'producer').map((item) => item.producerCheckName),
      [input.observedRuns[0].checkRuns[0].name]);
  }
});

test('missing observed cell and wrong provider do not silently join', async () => {
  const input = matrixDemo({ a: [1, 2], b: [3, 4] });
  input.observedRuns[0].checkRuns.shift();
  assert.equal((await auditControlPlane(input)).status, 'collection-error');
  const providerInput = matrixDemo({ a: [1, 2], b: [3, 4] });
  providerInput.observedRuns[0].checkRuns[0].provider = { kind: 'github-app', integrationId: 42 };
  providerInput.controlPlane.rulesets[0].requiredStatusChecks.push({ context: providerInput.observedRuns[0].checkRuns[0].name, integrationId: 15368 });
  assert.equal((await auditControlPlane(providerInput)).status, 'collection-error');
});

test('a required matrix cell does not hide uncovered siblings', async () => {
  const input = matrixDemo({ a: [1, 2], b: [3, 4] });
  input.controlPlane.rulesets[0].requiredStatusChecks.push({
    context: 'producer (1-3)', integrationId: 15368,
  });
  const report = await auditControlPlane(input);
  assert.equal(report.status, 'finding');
  assert.deepEqual(report.results.filter((item) => item.producer.jobId === 'producer').map((item) => item.producerCheckName),
    ['producer (1-4)', 'producer (2-3)', 'producer (2-4)']);
});
