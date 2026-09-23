import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runCli } from '../bin/gategraph.mjs';
import { createDemoInput } from '../src/demo-evidence.mjs';

test('demo defaults to a synthetic finding through the real core without live collection', async () => {
  let stdout = '';
  let stderr = '';
  let liveCalls = 0;
  const exitCode = await runCli(['demo'], {
    collectWithGh: async () => {
      liveCalls += 1;
      throw new Error('demo must not collect live evidence');
    },
    stdout: { write(chunk) { stdout += chunk; } },
    stderr: { write(chunk) { stderr += chunk; } },
  });

  assert.equal(liveCalls, 0);
  assert.equal(exitCode, 2);
  assert.equal(stderr, '');
  const report = JSON.parse(stdout);
  assert.equal(report.status, 'finding');
  assert.equal(report.subject.kind, 'fixture');
  assert.equal(report.subject.id, 'synthetic-demo-finding');
  assert.equal(report.provenance.analyzer, 'gategraph-ci');
  assert.equal(report.results.filter((result) => result.status === 'finding').length, 1);
});

for (const [scenario, expectedExit] of [
  ['finding', 2], ['policy-review', 3], ['unknown', 0], ['collection-error', 4],
]) {
  test(`demo ${scenario} uses the real core and exits ${expectedExit}`, async () => {
    let stdout = '';
    const exitCode = await runCli(['demo', '--scenario', scenario], {
      collectWithGh: async () => { assert.fail('live collection invoked'); },
      stdout: { write(chunk) { stdout += chunk; } },
      stderr: { write() { assert.fail('unexpected diagnostic'); } },
    });
    assert.equal(exitCode, expectedExit);
    const report = JSON.parse(stdout);
    assert.equal(report.status, scenario);
    assert.equal(report.subject.id, `synthetic-demo-${scenario}`);
    assert.equal(report.subject.kind, 'fixture');
    assert.equal(report.subject.repository, 'fixture/synthetic-demo');
    assert.equal(report.provenance.version, '0.2.0-experimental.2');
  });
}

for (const argv of [['--help'], ['demo', '--help'], ['audit', '--help'], ['--version']]) {
  test(`${argv.join(' ')} explains the installed command without collecting or auditing`, async () => {
    let stdout = '';
    const exitCode = await runCli(argv, {
      collectWithGh: async () => { assert.fail('live collection invoked'); },
      auditControlPlane: async () => { assert.fail('audit invoked'); },
      stdout: { write(chunk) { stdout += chunk; } },
      stderr: { write() { assert.fail('unexpected diagnostic'); } },
    });
    assert.equal(exitCode, 0);
    if (argv[0] === '--version') {
      const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
      assert.equal(stdout, `${manifest.name} ${manifest.version}\n`);
    } else {
      assert.match(stdout, /First task: gategraph demo/);
      assert.match(stdout, /synthetic fixtures/);
      assert.match(stdout, /exit 2 is expected/);
      assert.match(stdout, /Unknown is not a safety claim/);
    }
  });
}

for (const argv of [
  ['demo', '--scenario'], ['demo', '--scenario', 'UNTRUSTED_ARGUMENT_CANARY'],
  ['demo', '--scenario', 'finding', '--scenario', 'unknown'],
  ['demo', 'finding'], ['demo', '--help', 'extra'], ['--version', 'extra'],
]) {
  test(`rejects malformed command ${argv.join(' ')} before invoking dependencies`, async () => {
    let stdout = '';
    let stderr = '';
    const exitCode = await runCli(argv, {
      collectWithGh: async () => { assert.fail('live collection invoked'); },
      auditControlPlane: async () => { assert.fail('audit invoked'); },
      stdout: { write(chunk) { stdout += chunk; } },
      stderr: { write(chunk) { stderr += chunk; } },
    });
    assert.equal(exitCode, 1);
    assert.equal(stdout, '');
    assert.match(stderr, /^Usage: gategraph /);
    assert.equal(stderr.includes('UNTRUSTED_ARGUMENT_CANARY'), false);
  });
}

test('demo evidence is fresh on every call and rejects unsupported scenarios', () => {
  const first = createDemoInput();
  const second = createDemoInput();
  assert.deepEqual(first, second);
  assert.notEqual(first.policy, second.policy);
  assert.notEqual(first.observedRuns[0], second.observedRuns[0]);
  assert.throws(() => createDemoInput('unsupported'), TypeError);
});
