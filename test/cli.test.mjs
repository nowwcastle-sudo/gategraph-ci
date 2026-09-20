import assert from 'node:assert/strict';
import test from 'node:test';
import { runCli } from '../bin/gategraph.mjs';

const repository = 'example/project';
const sha = '0123456789abcdef0123456789abcdef01234567';
const argv = ['audit', '--repo', repository, '--sha', sha];

function captureStream() {
  let value = '';
  return {
    stream: { write(chunk) { value += chunk; } },
    read() { return value; },
  };
}

for (const [status, expectedExit] of [
  ['unknown', 0],
  ['finding', 2],
  ['policy-review', 3],
  ['collection-error', 4],
]) {
  test(`writes one ${status} report to stdout and exits ${expectedExit}`, async () => {
    const stdout = captureStream();
    const stderr = captureStream();
    const canonicalInput = { subject: { kind: 'github', id: `${repository}@${sha}` } };
    const report = { version: 1, status, subject: canonicalInput.subject, results: [] };
    const seen = [];

    const exitCode = await runCli(argv, {
      collectWithGh: async (coordinate) => {
        seen.push(['collect', coordinate]);
        return canonicalInput;
      },
      auditControlPlane: async (input) => {
        seen.push(['audit', input]);
        return report;
      },
      stdout: stdout.stream,
      stderr: stderr.stream,
    });

    assert.equal(exitCode, expectedExit);
    assert.equal(stdout.read(), `${JSON.stringify(report)}\n`);
    assert.equal(stderr.read(), '');
    assert.deepEqual(seen, [
      ['collect', { repository, sha }],
      ['audit', canonicalInput],
    ]);
  });
}

test('returns usage exit 1 without invoking dependencies', async () => {
  const stdout = captureStream();
  const stderr = captureStream();
  let calls = 0;
  const forbidden = 'TOKEN_CANARY_USAGE_9f13';

  const exitCode = await runCli(['audit', '--repo', repository, '--sha', forbidden], {
    collectWithGh: async () => { calls += 1; },
    auditControlPlane: async () => { calls += 1; },
    stdout: stdout.stream,
    stderr: stderr.stream,
  });

  assert.equal(exitCode, 1);
  assert.equal(calls, 0);
  assert.equal(stdout.read(), '');
  assert.equal(stderr.read(), 'Usage: gategraph audit --repo owner/name --sha 40-hex-commit\n');
  assert.equal(`${stdout.read()}${stderr.read()}`.includes(forbidden), false);
});

test('returns exit 1 for a sanitized unexpected failure without stdout or stack', async () => {
  const stdout = captureStream();
  const stderr = captureStream();
  const canary = 'TOKEN_CANARY_CLI_9f13';

  const exitCode = await runCli(argv, {
    collectWithGh: async () => { throw new Error(`collector exploded ${canary}`); },
    auditControlPlane: async () => { throw new Error('must not run'); },
    stdout: stdout.stream,
    stderr: stderr.stream,
  });

  assert.equal(exitCode, 1);
  assert.equal(stdout.read(), '');
  assert.equal(stderr.read(), 'INTERNAL_ERROR\n');
  assert.equal(`${stdout.read()}${stderr.read()}`.includes(canary), false);
  assert.equal(stderr.read().includes('at '), false);
});

test('treats an unsupported report status as a programmer error', async () => {
  const stdout = captureStream();
  const stderr = captureStream();

  const exitCode = await runCli(argv, {
    collectWithGh: async () => ({}),
    auditControlPlane: async () => ({ version: 1, status: 'safe', results: [] }),
    stdout: stdout.stream,
    stderr: stderr.stream,
  });

  assert.equal(exitCode, 1);
  assert.equal(stdout.read(), '');
  assert.equal(stderr.read(), 'INTERNAL_ERROR\n');
});
