# Prepare the current source candidate

This route uses an existing checkout with Node.js 24, npm and Git available.
It builds a clean checkout of https://github.com/nowwcastle-sudo/gategraph-ci
at the selected source commit. The existing v0.2.0-experimental.1 release remains immutable;
later source builds include the Korean README and must not replace that asset.
Use synthetic data only.
The package remains private to block npm publication; GitHub source and release
assets are public. Anonymous asset download is documented in the README.

## 1. Build and identify the archive

Open PowerShell in the checkout root. Run these lines in the same session and
stop on any error. The clean tracked-source check prevents labeling a dirty
build as an exact commit. The fresh destination preserves earlier candidates.

```powershell
$ErrorActionPreference = 'Stop'
$gategraphSource = git rev-parse HEAD
if ($LASTEXITCODE -ne 0) { throw 'Open PowerShell at the Git checkout root.' }
$gategraphDirty = @(git status --porcelain=v1 --untracked-files=no)
if ($LASTEXITCODE -ne 0 -or $gategraphDirty.Count -ne 0) { throw 'Record and commit intended source changes before building an exact-source candidate.' }
$gategraphCandidate = Join-Path ([IO.Path]::GetTempPath()) ('gategraph-candidate-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $gategraphCandidate | Out-Null
$gategraphPackJson = npm.cmd pack --ignore-scripts --json --pack-destination $gategraphCandidate
$gategraphPackExit = $LASTEXITCODE
if ($gategraphPackExit -ne 0) { throw 'Packaging failed; preserve this directory and logs.' }
$gategraphPack = @(($gategraphPackJson -join [Environment]::NewLine) | ConvertFrom-Json)
if ($gategraphPack.Count -ne 1) { throw 'Expected one package manifest.' }
$gategraphExpected = @('LICENSE','README.md','README.ko.md','package.json','bin/gategraph.mjs','src/audit-control-plane.mjs','src/demo-evidence.mjs','src/gh-adapter.mjs','src/policy-input.mjs','src/static-matrix.mjs','src/coverage-snapshot.mjs','src/report-input.mjs') | Sort-Object
$gategraphActual = @($gategraphPack[0].files.path) | Sort-Object
if (($gategraphActual -join ',') -cne ($gategraphExpected -join ',')) { throw 'Unexpected package member set.' }
$gategraphTarball = Join-Path $gategraphCandidate $gategraphPack[0].filename
$gategraphHash = (Get-FileHash -LiteralPath $gategraphTarball -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText(($gategraphTarball + '.sha256'), ($gategraphHash + '  ' + $gategraphPack[0].filename + [Environment]::NewLine), [Text.Encoding]::ASCII)
[IO.File]::WriteAllText((Join-Path $gategraphCandidate 'source.txt'), ('source_commit=' + $gategraphSource + [Environment]::NewLine), [Text.Encoding]::ASCII)
$gategraphTarball
Get-Content -LiteralPath ($gategraphTarball + '.sha256')
Get-Content -LiteralPath (Join-Path $gategraphCandidate 'source.txt')
```

Current source candidate builds have exactly 12 files including LICENSE and README.ko.md.
npm includes README variants automatically. The already published release has
eight files and remains unchanged. The package metadata still yields the filename
gategraph-ci-0.2.0-experimental.1.tgz; source.txt and the checksum identify a fresh
local build. Do not upload it over the fixed release asset.
Keep source.txt, this candidate's checksum and the archive together. A locally produced checksum is an identity record, not
independent publisher authentication.

## 2. Prepare the pinned dependency and install offline

The archive is not a standalone offline bundle: it depends on yaml@2.9.0.
The following cache preparation deliberately uses the registry once. The
subsequent installation is offline and uses that same explicit cache.
Do not continue if setup fails or silently remove the offline flag.

```powershell
$gategraphCache = Join-Path $gategraphCandidate 'npm-cache'
npm.cmd cache add yaml@2.9.0 --cache $gategraphCache --ignore-scripts --no-audit --no-fund
$gategraphCacheExit = $LASTEXITCODE
if ($gategraphCacheExit -ne 0) { throw 'Dependency preparation failed; preserve output and stop.' }
if ((Get-FileHash -LiteralPath $gategraphTarball -Algorithm SHA256).Hash.ToLowerInvariant() -cne $gategraphHash) { throw 'Candidate checksum changed; stop.' }
$gategraphInstall = Join-Path $gategraphCandidate 'installed'
if (Test-Path -LiteralPath $gategraphInstall) { throw 'Choose a fresh candidate directory; do not reuse this prefix.' }
npm.cmd install --prefix $gategraphInstall --cache $gategraphCache --offline --ignore-scripts --no-audit --no-fund --no-package-lock $gategraphTarball
$gategraphInstallExit = $LASTEXITCODE
if ($gategraphInstallExit -ne 0) { throw 'Installation failed; preserve prefix/logs and do not run the demo.' }
```

A timeout, interrupted process or missing exit leaves installation UNKNOWN.
Stop without running the demo. No global installation, GitHub credentials or
real repository input is required.

## 3. Save and read the synthetic result

Continue in the same session after installation returned zero:

```powershell
$gategraphOutput = Join-Path $gategraphCandidate 'gategraph-demo.json'
& (Join-Path $gategraphInstall 'node_modules/.bin/gategraph.cmd') demo | Out-File -LiteralPath $gategraphOutput -Encoding utf8 -NoClobber -ErrorAction Stop
$gategraphDemoExit = $LASTEXITCODE
if ($gategraphDemoExit -ne 2) { throw 'Expected demo exit 2; preserve output and stop.' }
$gategraphReport = Get-Content -LiteralPath $gategraphOutput -Raw | ConvertFrom-Json
if ($gategraphReport.status -ne 'finding' -or $gategraphReport.subject.kind -ne 'fixture' -or $gategraphReport.subject.repository -ne 'fixture/synthetic-demo') { throw 'Unexpected demo identity or status.' }
if (@($gategraphReport.results).Count -ne 1) { throw 'Expected one synthetic finding.' }
$gategraphReport | ConvertTo-Json -Depth 20
$gategraphOutput
```

Exit `2` is expected because the fixture contains an uncovered voting failure
path. The installed demo needs no network, credentials, source checkout or
test helper. It does not authorize a real merge or demonstrate customer value.

## Publication boundary

The new [local workflow ceilings](../runtime-resource-limits.md) may reject
larger valid inputs. Preserve errors rather than treating incomplete evidence
as clean. Before publication, bind the final source, CI, security review and
archive hash; verify the private-reporting channel in [SECURITY](../../SECURITY.md). Adoption remains unverified. This procedure does not merge, publish, overwrite
an old release, change visibility or rewrite history.
