import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryDir = fileURLToPath(new URL('..', import.meta.url));
const expectedFiles = [
  'LICENSE', 'README.md', 'README.ko.md', 'bin/gategraph.mjs', 'package.json', 'src/audit-control-plane.mjs',
  'src/demo-evidence.mjs', 'src/gh-adapter.mjs', 'src/policy-input.mjs',
];

test('fresh tarball installs its exact runtime and runs without checkout, credentials, or gh', async (t) => {
  assert.equal(typeof process.env.npm_execpath, 'string', 'Run the installed-package check with npm test.');
  const packageDir = await mkdtemp(join(tmpdir(), 'gategraph-package-'));
  const installDir = await mkdtemp(join(tmpdir(), 'gategraph-install-'));
  const unrelatedDir = await mkdtemp(join(tmpdir(), 'gategraph-unrelated-'));
  const packed = spawnSync(process.execPath, [process.env.npm_execpath,
    'pack', '--json', '--ignore-scripts', '--pack-destination', packageDir], {
    cwd: repositoryDir, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(packed.status, 0, 'Fresh local npm pack must exit zero. Temporary artifacts are retained.');
  const manifests = JSON.parse(packed.stdout);
  assert.equal(manifests.length, 1);
  const [manifest] = manifests;
  assert.equal(manifest.filename, 'gategraph-ci-0.2.0-experimental.1.tgz');
  assert.deepEqual(manifest.files.map((file) => file.path).sort(), [...expectedFiles].sort());
  const tarball = join(packageDir, manifest.filename);
  const sha256 = createHash('sha256').update(await readFile(tarball)).digest('hex');

  const installed = spawnSync(process.execPath, [process.env.npm_execpath,
    'install', '--prefix', installDir, '--ignore-scripts', '--offline',
    '--no-audit', '--no-fund', '--no-package-lock', tarball], {
    cwd: unrelatedDir, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(installed.status, 0,
    'Offline install must exit zero; first run npm cache add yaml@2.9.0 --ignore-scripts --no-audit --no-fund using the same npm cache. No online fallback is attempted.');
  const installedRoot = join(installDir, 'node_modules', 'gategraph-ci');
  const installedManifest = JSON.parse(await readFile(join(installedRoot, 'package.json'), 'utf8'));
  assert.equal(installedManifest.name, 'gategraph-ci');
  assert.equal(installedManifest.version, '0.2.0-experimental.1');
  assert.equal(installedManifest.private, true);
  assert.deepEqual(installedManifest.dependencies, { yaml: '2.9.0' });

  const cli = join(installedRoot, 'bin', 'gategraph.mjs');
  const runtimeEnv = { SystemRoot: process.env.SystemRoot ?? '', PATH: '', HOME: unrelatedDir, USERPROFILE: unrelatedDir };
  for (const [args, status, exit] of [
    [['demo'], 'finding', 2],
    [['demo', '--scenario', 'finding'], 'finding', 2],
    [['demo', '--scenario', 'policy-review'], 'policy-review', 3],
    [['demo', '--scenario', 'unknown'], 'unknown', 0],
    [['demo', '--scenario', 'collection-error'], 'collection-error', 4],
  ]) {
    await t.test(`installed ${args.join(' ')} returns ${status}/${exit}`, () => {
      const result = spawnSync(process.execPath, [cli, ...args], {
        cwd: unrelatedDir, encoding: 'utf8', windowsHide: true, env: runtimeEnv,
      });
      assert.equal(result.status, exit);
      assert.equal(result.stderr, '');
      const report = JSON.parse(result.stdout);
      assert.equal(report.status, status);
      assert.equal(report.subject.kind, 'fixture');
      assert.equal(report.subject.repository, 'fixture/synthetic-demo');
      assert.equal(report.provenance.version, installedManifest.version);
    });
  }
  for (const option of ['--help', '--version']) {
    await t.test(`installed ${option} requires no evidence collection`, () => {
      const result = spawnSync(process.execPath, [cli, option], {
        cwd: unrelatedDir, encoding: 'utf8', windowsHide: true, env: runtimeEnv,
      });
      assert.equal(result.status, 0);
      assert.equal(result.stderr, '');
      if (option === '--version') assert.equal(result.stdout, 'gategraph-ci 0.2.0-experimental.1\n');
      else assert.match(result.stdout, /First task: gategraph demo/);
    });
  }
  if (process.platform === 'win32') {
    await t.test('installed Windows command shim runs the documented first task', async () => {
      const shim = join(installDir, 'node_modules', '.bin', 'gategraph.cmd');
      await access(shim);
      assert.doesNotMatch(shim, /["%!\r\n]/, 'Generated test path must be safe for the fixed cmd invocation.');
      const result = spawnSync(join(process.env.SystemRoot, 'System32', 'cmd.exe'),
        ['/d', '/s', '/c', `""${shim}" demo"`], {
          cwd: unrelatedDir, encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true,
          env: { ...runtimeEnv, PATH: dirname(process.execPath), PATHEXT: '.COM;.EXE;.BAT;.CMD',
            COMSPEC: join(process.env.SystemRoot, 'System32', 'cmd.exe') },
        });
      assert.equal(result.status, 2);
      assert.equal(result.stderr, '');
      assert.equal(JSON.parse(result.stdout).subject.kind, 'fixture');
    });
  }
  t.diagnostic(JSON.stringify({ artifact: manifest.filename, sha256, members: expectedFiles,
    install: 'offline', runtime: 'isolated installed package', credentials: 'not inherited' }));
});
