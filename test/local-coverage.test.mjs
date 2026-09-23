import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { auditControlPlane } from '../src/audit-control-plane.mjs';
import { createDemoInput } from '../src/demo-evidence.mjs';

test('explanation preserves default findings and describes all producer jobs', async () => {
  const input = createDemoInput('finding');
  const original = structuredClone(input);
  const plain = await auditControlPlane(input);
  const explained = await auditControlPlane(input, { explain: true });
  assert.equal(JSON.stringify(await auditControlPlane(input)), JSON.stringify(plain));
  assert.deepEqual(input, original);
  assert.deepEqual(explained.results, plain.results);
  assert.equal(explained.status, plain.status);
  assert.equal(explained.coverageSnapshot.producers.length, 3);
  assert.equal(explained.coverageSnapshot.complete, true);
  assert.equal(explained.coverageSnapshot.schema, 'gategraph-coverage/1');
  assert.equal(explained.coverageSnapshot.observation.subjectKind, 'fixture');
  assert.equal(explained.coverageSnapshot.workflows[0].digest,
    createHash('sha256').update(input.workflows[0].text, 'utf8').digest('hex'));
  const { canonicalDigest } = await import('../src/coverage-snapshot.mjs');
  const { digest, ...withoutDigest } = explained.coverageSnapshot;
  assert.equal(digest, canonicalDigest(withoutDigest));
  assert.deepEqual(Object.fromEntries(explained.coverageSnapshot.producers.map(({ jobId, coverage }) => [jobId, coverage])), {
    dependency: 'required-aggregate', gate: 'direct', producer: 'uncovered',
  });
  assert.deepEqual(explained.coverageSnapshot.producers.map(({ id }) => id),
    explained.coverageSnapshot.producers.map(({ id }) => id).sort());
  assert.equal(explained.suggestions.length, 2);
  assert.ok(explained.suggestions.every((item) => item.requires_review && item.reaudit_required));
  assert.deepEqual(explained.suggestions[0].coordinates.producer, plain.results[0].producer);
});

test('advisory and unsupplied intent remain separate from coverage', async () => {
  for (const [scenario, expected] of [['unknown', 'advisory'], ['policy-review', 'unknown']]) {
    const report = await auditControlPlane(createDemoInput(scenario), { explain: true });
    assert.equal(report.coverageSnapshot.producers.find((p) => p.jobId === 'producer').coverage, expected);
    assert.equal(report.suggestions.length, 0);
  }
  const incomplete = await auditControlPlane(createDemoInput('collection-error'), { explain: true });
  assert.equal(incomplete.status, 'collection-error');
  assert.equal(Object.hasOwn(incomplete, 'coverageSnapshot'), false);
  assert.equal(Object.hasOwn(incomplete, 'suggestions'), false);
});

test('canonical digest ignores object insertion order but rejects unsupported values', async () => {
  const { canonicalDigest } = await import('../src/coverage-snapshot.mjs');
  assert.equal(canonicalDigest({ b: [1, true], a: 'x' }), canonicalDigest({ a: 'x', b: [1, true] }));
  assert.throws(() => canonicalDigest({ omitted: undefined }), TypeError);
  assert.throws(() => canonicalDigest({ nan: NaN }), TypeError);
  const adorned = [1];
  adorned.extra = 'not JSON';
  assert.throws(() => canonicalDigest(adorned), TypeError);
  const symbolKey = [1];
  symbolKey[Symbol('hidden')] = 2;
  assert.throws(() => canonicalDigest(symbolKey), TypeError);
  const sparseExtra = Array(1);
  sparseExtra.extra = 1;
  assert.throws(() => canonicalDigest(sparseExtra), TypeError);
  let getterCalls = 0;
  const accessor = [1];
  Object.defineProperty(accessor, '0', { enumerable: true, get() { getterCalls += 1; return 1; } });
  assert.throws(() => canonicalDigest(accessor), TypeError);
  assert.equal(getterCalls, 0);
});

test('reordered required-source facts do not change the snapshot digest', async () => {
  const input = createDemoInput('finding');
  input.controlPlane.rulesets.push({ ...structuredClone(input.controlPlane.rulesets[0]), id: 2 });
  const reordered = structuredClone(input);
  reordered.controlPlane.rulesets.reverse();
  const defaultBefore = await auditControlPlane(input);
  const first = await auditControlPlane(input, { explain: true });
  const second = await auditControlPlane(reordered, { explain: true });
  assert.deepEqual(await auditControlPlane(input), defaultBefore);
  assert.deepEqual(defaultBefore.results[0].activeGates[0].sources.map((source) => source.id), ['1', '2']);
  assert.deepEqual((await auditControlPlane(reordered)).results[0].activeGates[0].sources.map((source) => source.id), ['2', '1']);
  assert.equal(first.status, 'finding');
  assert.equal(second.status, 'finding');
  assert.deepEqual(first.coverageSnapshot.observation, second.coverageSnapshot.observation);
  assert.equal(first.coverageSnapshot.policyFingerprint, second.coverageSnapshot.policyFingerprint);
  assert.equal(first.coverageSnapshot.digest, second.coverageSnapshot.digest);
});

test('snapshot resource ceilings reject overflow, including serialized UTF-8', async () => {
  const { buildCoverageSnapshot, canonicalDigest } = await import('../src/coverage-snapshot.mjs');
  const input = createDemoInput();
  const minimal = {
    repository: input.subject.repository, sourceSha: input.subject.sha, targetRef: input.subject.ref,
    analysisContract: input.analysis.contract, scope: [], workflows: [], producers: [], gates: [], edges: [], links: [],
    policyFingerprint: canonicalDigest([]), observation: { sourceSha: input.subject.sha, analyzedAt: input.analysis.analyzedAt },
  };
  assert.equal(buildCoverageSnapshot({ ...minimal, producers: Array(4096).fill({ id: 'x' }) }).complete, true);
  assert.throws(() => buildCoverageSnapshot({ ...minimal, producers: Array(4097).fill({ id: 'x' }) }), /COVERAGE_RESOURCE_LIMIT/);
  const edge = { workflowPath: 'a', fromJobId: 'b', toJobId: 'c' };
  assert.equal(buildCoverageSnapshot({ ...minimal, edges: Array(16384).fill(edge) }).complete, true);
  assert.throws(() => buildCoverageSnapshot({ ...minimal, edges: Array(16385).fill(edge) }), /COVERAGE_RESOURCE_LIMIT/);
  assert.throws(() => buildCoverageSnapshot({ ...minimal, observation: { note: '한'.repeat(350000) } }), /COVERAGE_RESOURCE_LIMIT/);
  const empty = buildCoverageSnapshot({ ...minimal, observation: { note: '' } });
  const fill = 1048576 - Buffer.byteLength(JSON.stringify(empty), 'utf8');
  assert.equal(Buffer.byteLength(JSON.stringify(buildCoverageSnapshot({ ...minimal,
    observation: { note: 'a'.repeat(fill) } })), 'utf8'), 1048576);
  assert.throws(() => buildCoverageSnapshot({ ...minimal, observation: { note: 'a'.repeat(fill + 1) } }),
    /COVERAGE_RESOURCE_LIMIT/);
});

test('partial matrix requirements protect only exact observed cells', async () => {
  const input = createDemoInput('finding');
  input.workflows[0].text = input.workflows[0].text.replace('    name: producer',
    '    name: producer (${{ matrix.os }}-${{ matrix.node }})\n    strategy:\n      matrix:\n        os: [win, linux]\n        node: [22, 24]');
  const producer = input.observedRuns[0].checkRuns.shift();
  input.observedRuns[0].checkRuns.unshift(...['win-22', 'win-24', 'linux-22', 'linux-24'].map((axes) => ({
    ...producer, name: `producer (${axes})`,
  })));
  input.controlPlane.rulesets[0].requiredStatusChecks.push({ context: 'producer (win-22)', integrationId: 15368 });
  const report = await auditControlPlane(input, { explain: true });
  const cells = report.coverageSnapshot.producers.filter((item) => item.jobId === 'producer');
  assert.equal(cells.length, 4);
  assert.deepEqual(cells.map((item) => item.coverage).sort(), ['direct', 'uncovered', 'uncovered', 'uncovered']);
  assert.deepEqual(report.results.filter((item) => item.producer.jobId === 'producer')
    .map((item) => item.producerCheckName).sort(),
  ['producer (linux-22)', 'producer (linux-24)', 'producer (win-24)']);
  assert.equal(report.suggestions.filter((item) => item.kind === 'review-required-context').length, 3);
});

test('missing aggregate proof and cross-provider names cannot be explained as covered', async () => {
  const noProof = createDemoInput('finding');
  noProof.policy.gates = {};
  const first = await auditControlPlane(noProof, { explain: true });
  assert.equal(first.status, 'collection-error');
  assert.equal(Object.hasOwn(first, 'coverageSnapshot'), false);
  const wrongProvider = createDemoInput('finding');
  wrongProvider.controlPlane.rulesets[0].requiredStatusChecks[0].integrationId = 42;
  const second = await auditControlPlane(wrongProvider, { explain: true });
  assert.equal(second.status, 'collection-error');
  assert.equal(Object.hasOwn(second, 'coverageSnapshot'), false);
  const collision = createDemoInput('finding');
  collision.observedRuns[0].checkRuns.push({ ...collision.observedRuns[0].checkRuns[0],
    provider: { kind: 'github-app', integrationId: 42 } });
  assert.equal((await auditControlPlane(collision, { explain: true })).status, 'collection-error');
  const twoWorkflows = createDemoInput('finding');
  const otherPath = '.github/workflows/other.yml';
  twoWorkflows.workflows.push({ path: otherPath, sha: twoWorkflows.subject.sha,
    text: 'on: pull_request\njobs:\n  same:\n    name: producer\n' });
  twoWorkflows.observedRuns.push({ ...twoWorkflows.observedRuns[0], runId: 'synthetic-other-run',
    workflowPath: otherPath, checkRuns: [{ ...twoWorkflows.observedRuns[0].checkRuns[0] }] });
  const ambiguous = await auditControlPlane(twoWorkflows, { explain: true });
  assert.equal(ambiguous.status, 'collection-error');
  assert.equal(Object.hasOwn(ambiguous, 'coverageSnapshot'), false);
});

test('policy fingerprint ignores observation time and run/source ordering', async () => {
  const input = createDemoInput('finding');
  const before = await auditControlPlane(input, { explain: true });
  input.analysis.analyzedAt = '2026-09-21T00:00:00.000Z';
  input.collection.sources.reverse();
  input.observedRuns[0].checkRuns.reverse();
  const after = await auditControlPlane(input, { explain: true });
  assert.equal(after.coverageSnapshot.policyFingerprint, before.coverageSnapshot.policyFingerprint);
  assert.equal(after.coverageSnapshot.digest === before.coverageSnapshot.digest, false);
  input.policy.jobs[0].mergePolicy = 'advisory';
  assert.notEqual((await auditControlPlane(input, { explain: true })).coverageSnapshot.policyFingerprint,
    before.coverageSnapshot.policyFingerprint);
});

test('diamond dependency fan-in uses bounded edges, not exponential path lists', async () => {
  const input = createDemoInput('finding');
  const jobs = ['  root:', '    name: root'];
  let preceding = ['root'];
  const names = ['root'];
  for (let depth = 0; depth < 20; depth += 1) {
    const layer = [`a${depth}`, `b${depth}`];
    for (const name of layer) jobs.push(`  ${name}:`, `    name: ${name}`, `    needs: [${preceding.join(', ')}]`);
    names.push(...layer);
    preceding = layer;
  }
  jobs.push('  gate:', '    name: gate', '    if: always()', `    needs: [${preceding.join(', ')}]`);
  names.push('gate');
  input.workflows[0].text = ['on: pull_request', 'jobs:', ...jobs, ''].join('\n');
  const observed = input.observedRuns[0].checkRuns[0];
  input.observedRuns[0].checkRuns = names.map((name) => ({ ...observed, name }));
  input.policy.jobs = [{ workflowPath: input.workflows[0].path, jobId: 'root', mergePolicy: 'voting' }];
  const report = await auditControlPlane(input, { explain: true });
  assert.equal(report.status, 'unknown');
  assert.equal(report.coverageSnapshot.producers.length, 42);
  assert.equal(report.coverageSnapshot.edges.length, 80);
  assert.equal(report.coverageSnapshot.links.length, 42);
  assert.equal(report.coverageSnapshot.producers.find((item) => item.jobId === 'root').coverage, 'required-aggregate');
});

test('explain-only byte ceiling fails closed without changing the normal audit', async () => {
  const input = createDemoInput('finding');
  const source = { name: 'policy', outcome: 'observed', complete: true,
    endpoint: `repos/${'a'.repeat(2040)}` };
  input.collection.sources.push(...Array(600).fill(source));
  const plain = await auditControlPlane(input);
  assert.equal(plain.status, 'finding');
  const explained = await auditControlPlane(input, { explain: true });
  assert.equal(explained.status, 'collection-error');
  assert.equal(explained.results[0].reasonCode, 'COVERAGE_RESOURCE_LIMIT');
  assert.equal(Object.hasOwn(explained, 'coverageSnapshot'), false);
  assert.equal(Object.hasOwn(explained, 'suggestions'), false);
});

test('only accepted provider identity enters producer and gate records', async () => {
  const input = createDemoInput('finding');
  for (const check of input.observedRuns[0].checkRuns) check.provider.untrustedNote = 'SECRET_CANARY_PROVIDER';
  const report = await auditControlPlane(input, { explain: true });
  assert.equal(report.status, 'finding');
  assert.equal(JSON.stringify(report).includes('SECRET_CANARY_PROVIDER'), false);
  assert.deepEqual(report.coverageSnapshot.gates[0].provider, { kind: 'github-app', integrationId: 15368 });
});
