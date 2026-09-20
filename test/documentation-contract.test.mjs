import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { readSavedReport } from '../src/report-input.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function read(relativePath) {
  return readFile(resolve(repoRoot, relativePath), 'utf8');
}

function powershellBlockAfter(markdown, heading) {
  const headingIndex = markdown.indexOf(heading);
  assert.notEqual(headingIndex, -1, `Missing heading: ${heading}`);
  const fenceIndex = markdown.indexOf('```powershell', headingIndex);
  assert.notEqual(fenceIndex, -1, `Missing PowerShell block after: ${heading}`);
  const bodyIndex = markdown.indexOf('\n', fenceIndex) + 1;
  const endIndex = markdown.indexOf('\n```', bodyIndex);
  assert.notEqual(endIndex, -1, `Unclosed PowerShell block after: ${heading}`);
  return markdown.slice(bodyIndex, endIndex).replace(/\r\n?/g, '\n');
}

function assertFirstUseContract(readme) {
  const install = powershellBlockAfter(readme, '## First task: run the installed synthetic demo');
  const installLines = install.split('\n');
  const installIndex = installLines.findIndex((line) => line.startsWith('npm.cmd install '));
  assert.notEqual(installIndex, -1, 'Missing documented install command.');
  assert.equal(installLines[installIndex + 1], '$gategraphInstallExit = $LASTEXITCODE',
    'Capture the native install exit on the next line.');
  assert.match(installLines[installIndex + 2],
    /^if \(\$gategraphInstallExit -ne 0\) \{ throw /,
    'Stop unless the completed install exits zero.');

  const save = powershellBlockAfter(readme, '### Save and read back the complete demo report');
  const saveLines = save.split('\n');
  const demoIndex = saveLines.findIndex((line) => line.includes("'node_modules/.bin/gategraph.cmd') demo | Out-File "));
  assert.notEqual(demoIndex, -1, 'Missing documented demo save command.');
  assert.match(saveLines[demoIndex - 2], /^\$gategraphOutput = Join-Path \(Get-Location\) /,
    'Choose a fresh output path in the current directory.');
  assert.equal(saveLines[demoIndex - 1],
    "if (Test-Path -LiteralPath $gategraphOutput) { throw 'Choose a new demo output path.' }",
    'Refuse an existing output path before running the demo.');
  assert.match(saveLines[demoIndex],
    /Out-File -LiteralPath \$gategraphOutput -Encoding utf8 -NoClobber -ErrorAction Stop$/,
    'Save UTF-8 through a literal, no-clobber path.');
  assert.equal(saveLines[demoIndex + 1], '$gategraphDemoExit = $LASTEXITCODE',
    'Capture the native demo exit on the next line.');
  assert.equal(saveLines[demoIndex + 2],
    "if ($gategraphDemoExit -ne 2) { throw \"Unexpected demo exit: $gategraphDemoExit. Keep the output and stop.\" }",
    'The default finding demo must exit two.');
  assert.equal(saveLines[demoIndex + 3],
    '$gategraphReport = Get-Content -LiteralPath $gategraphOutput -Raw | ConvertFrom-Json',
    'Read back and parse the complete saved JSON document.');
  assert.equal(saveLines[demoIndex + 4],
    "if ($gategraphReport.status -ne 'finding') { throw 'Expected status: finding.' }",
    'Verify the documented finding status.');
  assert.equal(saveLines[demoIndex + 5],
    "if ($gategraphReport.subject.kind -ne 'fixture') { throw 'Expected subject.kind: fixture.' }",
    'Verify the documented synthetic subject kind.');
  assert.equal(saveLines[demoIndex + 6],
    "if ($gategraphReport.subject.repository -ne 'fixture/synthetic-demo') { throw 'Expected repository: fixture/synthetic-demo.' }",
    'Verify the documented synthetic repository.');
  assert.equal(saveLines[demoIndex + 7], '$gategraphOutput',
    'Print the saved path for handoff.');
  return { install, save };
}

function removeLine(script, exactLine) {
  return script.split('\n').filter((line) => line !== exactLine).join('\n');
}

function withControlledPaths(script, outputPath, invokedPath) {
  const body = script.split('\n').filter((line) => !line.startsWith('$gategraphOutput = ')).join('\n');
  const quote = (value) => `'${value.replaceAll("'", "''")}'`;
  const producer = [
    '$global:LASTEXITCODE = 2',
    'function Invoke-GateGraphFixture {',
    `  Set-Content -LiteralPath ${quote(invokedPath)} -Value 'invoked' -Encoding utf8`,
    "  Write-Output '{\"status\":\"finding\",\"subject\":{\"kind\":\"fixture\",\"repository\":\"fixture/synthetic-demo\"}}'",
    '}',
  ].join('\n');
  const fixtureBody = body.replace(
    "& (Join-Path $gategraphInstall 'node_modules/.bin/gategraph.cmd') demo",
    'Invoke-GateGraphFixture demo',
  );
  return `$gategraphOutput = ${quote(outputPath)}\n${producer}\n${fixtureBody}`;
}

function replaceInPowerShellBlock(readme, heading, search, replacement) {
  const headingIndex = readme.indexOf(heading);
  assert.notEqual(headingIndex, -1, `Missing heading: ${heading}`);
  const fenceIndex = readme.indexOf('```powershell', headingIndex);
  assert.notEqual(fenceIndex, -1, `Missing PowerShell block after: ${heading}`);
  const start = readme.indexOf('\n', fenceIndex) + 1;
  const end = readme.indexOf('\n```', start);
  assert.notEqual(end, -1, `Unclosed PowerShell block after: ${heading}`);
  const block = readme.slice(start, end);
  const changed = block.replace(search, replacement);
  assert.notEqual(changed, block, 'Mutation must affect the selected block.');
  return readme.slice(0, start) + changed + readme.slice(end);
}

function assertRejectedMutation(readme, heading, search, replacement, expected, label) {
  const mutant = replaceInPowerShellBlock(readme, heading, search, replacement);
  assert.notEqual(mutant, readme, `${label} mutation must be applied.`);
  assert.throws(() => assertFirstUseContract(mutant), expected);
  return { mutationApplied: true, contractRejected: true };
}

test('experimental release documentation keeps the first-use safety contract', async () => {
  const readme = await read('README.md');
  const runbook = await read('docs/release/public-candidate.md');
  const combined = `${readme}\n${runbook}`;

  assert.match(readme, /Invoke-WebRequest/);
  assert.match(readme, /releases\/download\/v0\.2\.0-experimental\.1/);
  assert.match(readme, /Get-FileHash/);
  assert.match(readme, /--offline/);
  assert.match(runbook, /preserve.*logs/i);
  assert.match(runbook, /[Ee]xit `2`/);
  assert.doesNotMatch(combined, /ghp_[A-Za-z0-9]{20,}/);
  assert.doesNotMatch(combined, /github_pat_[A-Za-z0-9_]{20,}/);
  assert.doesNotMatch(combined, /-----BEGIN [A-Z ]*PRIVATE KEY-----/);
});

test('first-use commands capture native exits immediately and preserve the complete JSON report', async (t) => {
  const readmeLf = (await read('README.md')).replace(/\r\n?/g, '\n');
  const results = [];

  for (const newline of ['\n', '\r\n']) {
    const lineEnding = newline === '\n' ? 'LF' : 'CRLF';
    const readme = readmeLf.replace(/\n/g, newline);
    const { install, save } = assertFirstUseContract(readme);
    const mutations = {
      installCaptureMissing: assertRejectedMutation(readme,
        '## First task: run the installed synthetic demo',
        `$gategraphInstallExit = $LASTEXITCODE${newline}`, '',
        /Capture the native install exit/, `${lineEnding} install-capture-missing`),
      installCaptureSeparated: assertRejectedMutation(readme,
        '## First task: run the installed synthetic demo',
        `$gategraphInstallExit = $LASTEXITCODE${newline}`,
        `Write-Output 'separated'${newline}$gategraphInstallExit = $LASTEXITCODE${newline}`,
        /Capture the native install exit/, `${lineEnding} install-capture-separated`),
      demoCaptureMissing: assertRejectedMutation(readme,
        '### Save and read back the complete demo report',
        `$gategraphDemoExit = $LASTEXITCODE${newline}`, '',
        /Capture the native demo exit/, `${lineEnding} demo-capture-missing`),
      demoCaptureSeparated: assertRejectedMutation(readme,
        '### Save and read back the complete demo report',
        `$gategraphDemoExit = $LASTEXITCODE${newline}`,
        `Write-Output 'separated'${newline}$gategraphDemoExit = $LASTEXITCODE${newline}`,
        /Capture the native demo exit/, `${lineEnding} demo-capture-separated`),
      noClobberMissing: assertRejectedMutation(readme,
        '### Save and read back the complete demo report', ' -NoClobber', '',
        /Save UTF-8 through a literal, no-clobber path/, `${lineEnding} no-clobber-missing`),
    };
    assert.match(install, /Keep this directory and npm logs; do not run the demo/);
    assert.match(save, /Unexpected demo exit/);
    results.push({ lineEnding, positiveAccepted: true, mutations });
  }

  t.diagnostic(JSON.stringify(results));
});

test('first-use mutations select their block even after an earlier identical token', async () => {
  const readme = await read('README.md');
  const prefix = '$gategraphDemoExit = $LASTEXITCODE\nOut-File -NoClobber\n';
  const prefixed = `${prefix}${readme}`;
  const mutant = replaceInPowerShellBlock(prefixed, '### Save and read back the complete demo report',
    '$gategraphDemoExit = $LASTEXITCODE\n', '');
  assert.equal(mutant.slice(0, prefix.length), prefix);
  assert.throws(() => assertFirstUseContract(mutant), /Capture the native demo exit/);
});

test('source example saves strict UTF-8 JSON and compares it on both PowerShell versions',
  { skip: process.platform !== 'win32' }, async (t) => {
    const readme = await read('README.md');
    const example = powershellBlockAfter(readme, '## What the commands do');
    assert.match(example, /Out-File .* -NoClobber -ErrorAction Stop/);
    for (const [shell, bom] of [['pwsh', false], ['powershell.exe', true]]) {
      const result = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-Command', `${example}\n$gategraphSaved`], {
        cwd: repoRoot, encoding: 'utf8', windowsHide: true,
      });
      assert.equal(result.status, 0, `${shell}: ${result.stderr}`);
      assert.match(result.stdout, /"comparable":true,"changes":\[\]/);
      const path = result.stdout.trim().split(/\r?\n/).at(-1);
      const bytes = await readFile(path);
      assert.equal(bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), bom);
      assert.equal((await readSavedReport(path)).coverageSnapshot.complete, true);
      t.diagnostic(JSON.stringify({ shell, savedPath: path, bom, compareExit: 0 }));
    }
  });

test('copied save snippet refuses an existing path and the preservation assertion detects a guard-removal mutant',
  { skip: process.platform !== 'win32' }, async (t) => {
    const readme = await read('README.md');
    const { save } = assertFirstUseContract(readme);
    const retainedDir = await mkdtemp(join(tmpdir(), 'gategraph-doc-contract-'));
    const outputPath = join(retainedDir, 'existing.json');
    const invokedPath = join(retainedDir, 'invoked.txt');
    const sentinel = Buffer.from('existing output must remain unchanged\r\n', 'utf8');
    await writeFile(outputPath, sentinel);

    const controlled = withControlledPaths(save, outputPath, invokedPath);
    const blocked = spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', controlled], {
      cwd: retainedDir, encoding: 'utf8', windowsHide: true,
    });
    assert.notEqual(blocked.status, 0);
    assert.deepEqual(await readFile(outputPath), sentinel);
    await assert.rejects(readFile(invokedPath), { code: 'ENOENT' });

    const guardRemoved = removeLine(controlled,
      "if (Test-Path -LiteralPath $gategraphOutput) { throw 'Choose a new demo output path.' }")
      .replace(' -NoClobber', '');
    const mutated = spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', guardRemoved], {
      cwd: retainedDir, encoding: 'utf8', windowsHide: true,
    });
    assert.equal(mutated.status, 0, mutated.stderr);
    const mutatedBytes = await readFile(outputPath);
    assert.throws(() => assert.deepEqual(mutatedBytes, sentinel), { code: 'ERR_ASSERTION' });
    assert.equal(JSON.parse(mutatedBytes.toString('utf8')).status, 'finding');
    t.diagnostic(JSON.stringify({ retained: retainedDir, negative: 'existing-output', mutant: 'guards-removed' }));
  });
