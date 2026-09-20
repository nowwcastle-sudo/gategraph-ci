# GateGraph CI

GateGraph CI is an experimental, read-only diagnostic CLI for inspecting GitHub merge-gate evidence. It does not enforce merge policy or prove that a repository is safe. Maintainer adoption and production suitability remain unverified.

License: Apache License 2.0. See [LICENSE](LICENSE).
Source: [nowwcastle-sudo/gategraph-ci](https://github.com/nowwcastle-sudo/gategraph-ci), branch `main`.
Release: `v0.2.0-experimental.1`; package: `gategraph-ci@0.2.0-experimental.1`.
The package stays `private: true` to prevent accidental npm publication; public source and GitHub release downloads do not require an npm publication.

Workflow parsing and name expansion have [local resource ceilings](https://github.com/nowwcastle-sudo/gategraph-ci/blob/main/docs/runtime-resource-limits.md). Exceeding them returns `WORKFLOW_RESOURCE_LIMIT_EXCEEDED` as a collection error. These are analyzer limits, not GitHub Actions validity rules or whole-process memory/time guarantees.

## Download the experimental release anonymously

Use Node.js 24 and npm. In PowerShell, run each line in the same session.
No GitHub sign-in is needed for these public assets. Stop on a failed download
or checksum mismatch and retain the directory; never overwrite an old artifact.

```powershell
$ErrorActionPreference = 'Stop'
$gategraphAssets = Join-Path ([IO.Path]::GetTempPath()) ('gategraph-release-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $gategraphAssets -ErrorAction Stop | Out-Null
$gategraphRelease = 'https://github.com/nowwcastle-sudo/gategraph-ci/releases/download/v0.2.0-experimental.1'
$gategraphTarball = Join-Path $gategraphAssets 'gategraph-ci-0.2.0-experimental.1.tgz'
Invoke-WebRequest -Uri ($gategraphRelease + '/gategraph-ci-0.2.0-experimental.1.tgz') -OutFile $gategraphTarball
Invoke-WebRequest -Uri ($gategraphRelease + '/gategraph-ci-0.2.0-experimental.1.tgz.sha256') -OutFile ($gategraphTarball + '.sha256')
$gategraphHash = ((Get-Content -LiteralPath ($gategraphTarball + '.sha256') -Raw).Trim() -split '\s+')[0]
if ($gategraphHash -notmatch '^[a-fA-F0-9]{64}$') { throw 'Invalid checksum file; stop.' }
if ((Get-FileHash -LiteralPath $gategraphTarball -Algorithm SHA256).Hash -ine $gategraphHash) { throw 'Checksum mismatch; stop and retain downloads.' }
```

The checksum establishes agreement with the release checksum, not independent publisher authentication. A 404 means the named public asset is unavailable; a TLS, proxy or timeout failure is not proof that the release is absent.

## Prepare the pinned dependency cache

The TGZ is not a standalone offline bundle. It requires `yaml@2.9.0`.
Prepare registry metadata and the tarball while connected, then use the same
explicit cache for offline installation:

```powershell
$gategraphCache = Join-Path $gategraphAssets 'npm-cache'
npm.cmd cache add yaml@2.9.0 --cache $gategraphCache --ignore-scripts --no-audit --no-fund
$gategraphCacheExit = $LASTEXITCODE
if ($gategraphCacheExit -ne 0) { throw 'Dependency preparation failed; retain output and stop.' }
```

A fresh cache needs registry access for this step. A previously prepared cache
may support offline installation; missing metadata or dependency bytes must
stop installation. Do not silently remove `--offline` or change dependency versions.

## First task: run the installed synthetic demo

Continue after the verified download and cache preparation above. Run each line separately:

```powershell
$gategraphInstall = Join-Path ([IO.Path]::GetTempPath()) ('gategraph-install-' + [guid]::NewGuid().ToString('N'))
if (Test-Path -LiteralPath $gategraphInstall) { throw 'Choose a new temporary install directory.' }
npm.cmd install --prefix $gategraphInstall --cache $gategraphCache --offline --ignore-scripts --no-audit --no-fund --no-package-lock $gategraphTarball
$gategraphInstallExit = $LASTEXITCODE
if ($gategraphInstallExit -ne 0) { throw "GateGraph install did not complete successfully (exit $gategraphInstallExit). Keep this directory and npm logs; do not run the demo." }
```

PowerShell에서는 실행 정책에 따라 `npm`이 `npm.ps1`로 해석될 수 있으므로 Windows 설치 명령은 `npm.cmd`로 고정합니다.
고유한 임시 prefix를 사용해 이전 설치와 섞이지 않게 합니다. 성공하거나 실패한
prefix와 로그는 결과를 확인할 때까지 보존하고, 다음 시도에는 새 이름을 만듭니다.
Capture the install's native exit on the line immediately after `npm.cmd`.
Proceed only after a completed exit `0`. A timeout, interrupted process, missing
native exit, or residual prefix files leaves installation **UNKNOWN**; keep the
directory and logs, then stop without running the demo.

### Save and read back the complete demo report

Only after the verified install exit `0`, run each line separately in the same
PowerShell window. This uses the default synthetic demo and saves its complete
JSON stdout to a fresh UTF-8 file in the current directory:

```powershell
$gategraphOutput = Join-Path (Get-Location) ('gategraph-demo-' + [guid]::NewGuid().ToString('N') + '.json')
if (Test-Path -LiteralPath $gategraphOutput) { throw 'Choose a new demo output path.' }
& (Join-Path $gategraphInstall 'node_modules/.bin/gategraph.cmd') demo | Out-File -LiteralPath $gategraphOutput -Encoding utf8 -NoClobber -ErrorAction Stop
$gategraphDemoExit = $LASTEXITCODE
if ($gategraphDemoExit -ne 2) { throw "Unexpected demo exit: $gategraphDemoExit. Keep the output and stop." }
$gategraphReport = Get-Content -LiteralPath $gategraphOutput -Raw | ConvertFrom-Json
if ($gategraphReport.status -ne 'finding') { throw 'Expected status: finding.' }
if ($gategraphReport.subject.kind -ne 'fixture') { throw 'Expected subject.kind: fixture.' }
if ($gategraphReport.subject.repository -ne 'fixture/synthetic-demo') { throw 'Expected repository: fixture/synthetic-demo.' }
$gategraphOutput
```

The demo uses invented fixture evidence through the real audit core. Expect one JSON report with `status: finding`, `subject.kind: fixture`, and repository `fixture/synthetic-demo`. **Exit 2 is expected**: the demonstration contains one uncovered voting failure path.

Once installed, demo runtime needs no credentials, network, GitHub CLI, source checkout, or test helpers. GateGraph itself is not published to npm.

Try another scenario or inspect the installed command using the same PowerShell variable:

```powershell
& (Join-Path $gategraphInstall 'node_modules/.bin/gategraph.cmd') demo --scenario policy-review
& (Join-Path $gategraphInstall 'node_modules/.bin/gategraph.cmd') demo --scenario unknown
& (Join-Path $gategraphInstall 'node_modules/.bin/gategraph.cmd') demo --scenario collection-error
& (Join-Path $gategraphInstall 'node_modules/.bin/gategraph.cmd') --help
& (Join-Path $gategraphInstall 'node_modules/.bin/gategraph.cmd') --version
```

## Status and exit codes

| Status | Meaning | Exit code |
|---|---|---:|
| `finding` | Supplied policy and observed evidence prove an uncovered voting failure path. | 2 |
| `policy-review` | A graph gap is visible, but voting intent requires human review. | 3 |
| `unknown` | No finding is asserted for the bounded evidence, including explicit advisory policy. | 0 |
| `collection-error` | Required evidence is incomplete, malformed, unsupported, or ambiguous. | 4 |

An `unknown` result is not proof that a repository is safe. Audit and demo write exactly one JSON document to stdout; help/version write text and exit 0. Invalid command usage and unexpected internal failures exit 1.

## Live audits and explicit selection

Live audits additionally need an authenticated GitHub CLI (`gh`) and read permission for the target's Actions, contents, rulesets, and protection evidence. These command shapes use placeholders; substitute coordinates from an observed run before a live invocation:

```text
gategraph audit --repo owner/name --sha 40-hex-commit
gategraph audit --repo owner/name --sha 40-hex-commit --run-id ID --target-ref refs/heads/BRANCH
gategraph audit --repo owner/name --sha 40-hex-commit --run-id ID --target-ref refs/heads/BRANCH --policy-file reviewed-policy.json
```

For the local-prefix installation, use the full `gategraph.cmd` path shown in the first task. Options may be reordered; repeat `--run-id` for multiple workflows, selecting exactly one completed observed run per workflow. Without selectors, all observed runs remain in scope. No newest or successful run is selected implicitly.

`--target-ref` asserts the target already present in the selected run evidence. It cannot provide a missing PR base or substitute the repository's default branch. Explicit selection records excluded run IDs and workflow paths in `provenance.scope`. Collection completeness then applies to that scope. Every active required context remains required; excluding its workflow does not remove the requirement.

## Reviewed authored policy

Live collection does not infer voting policy or aggregate failure propagation. A directly required producer needs no aggregate policy. A required job with `needs` contributes transitive coverage only with exact `all-needs` evidence for its workflow/job identity. Dependency ancestry alone is not merge-blocking proof.

`--policy-file` is an explicit policy contract for operator-authored assertions. It requires both `--target-ref` and at least one `--run-id`. It does **not** authenticate maintainer approval or retrieve independent supporting evidence. Retain the reviewed evidence yourself and do not mark `all-needs` solely from a `needs` list. Gate-only evidence leaves voting intent unknown; voting-only evidence cannot prove aggregate propagation.

The following complete schema example uses invented coordinates and must not be treated as observed live evidence:

```json
{
  "contract": "gategraph-authored-policy/v1",
  "coordinate": {
    "repository": "example/project",
    "sha": "0123456789abcdef0123456789abcdef01234567",
    "targetRef": "refs/heads/main",
    "runs": [
      { "runId": "501", "workflowPath": ".github/workflows/ci.yml", "runAttempt": 2 }
    ]
  },
  "review": {
    "observedAt": "2026-09-05T06:00:00.000Z",
    "evidence": "operator-reviewed-gate-behavior-v1"
  },
  "jobs": [
    { "workflowPath": ".github/workflows/ci.yml", "jobId": "producer", "mergePolicy": "voting" },
    { "workflowPath": ".github/workflows/ci.yml", "jobId": "dependency", "mergePolicy": "voting" }
  ],
  "gates": {
    ".github/workflows/ci.yml/gate": {
      "failurePropagation": "all-needs",
      "evidence": "operator-reviewed-gate-failure-propagation-v1"
    }
  }
}
```

Use strict JSON within 64 KiB. Extra keys, duplicate decoded keys at any depth, prototype-related keys, malformed values, and duplicate run/job identities are rejected. Repository, SHA, target, selected run/workflow set, and observed run attempt must match. The collector reads jobs for that observed attempt, so a rerun cannot silently replace the reviewed attempt.

`observedAt` must be canonical UTC, after the Unix epoch and no later than this audit's analysis time. There is no arbitrary age cutoff. The audit freshly collects current active control-plane evidence; it does not claim that the current ruleset existed at the historical review time. Policy application preserves all previous failures and never turns incomplete collection into complete collection.

Every report records analyzer/version/contract/analysis-time provenance. Authored policy adds coordinate/time metadata and 12-hex SHA-256 fingerprints in `provenance.policyInput`; gate evidence is fingerprinted in `provenance.gatePolicies`. Raw evidence identifiers and local policy-file paths are not copied into the report.

## Recovering from collection errors

Read the result's `reasonCode` and `recoveryAction` when present:

- `TARGET_REF_UNRESOLVED`: select observed runs with an authoritative target. A target option cannot repair a missing inline PR base.
- `RUN_SELECTION_MISMATCH` or `RUN_SELECTION_AMBIGUOUS`: verify the run IDs at the requested SHA and select one completed run per workflow.
- `TARGET_REF_MISMATCH`: correct the asserted target after checking the observed evidence.
- `POLICY_INPUT_INVALID`: check JSON syntax, exact schema, size, and observation time.
- `POLICY_COORDINATE_MISMATCH`: review policy for the exact repository, SHA, target, workflow, run, and attempt.

Other incomplete or unsupported evidence also fails closed. A classic-protection 404 is not proof that no protection exists.

## Read-only guarantee

Live collection uses only allowlisted `gh api --method GET` requests. GateGraph does not execute workflow text, run workflows, change GitHub state, or apply automatic fixes.

## Limitations

- This is experimental OSS: diagnostics are not enforcement or production certification.
- It supports only the documented GitHub evidence subset; it is not an actionlint clone or a general GitHub Actions expression evaluator.
- Incomplete, malformed, unsupported, or ambiguous evidence fails closed as `collection-error`.
- Authored policy supplies an operator assertion; it does not authenticate the author or independently prove the asserted behavior.
- This command does not continuously monitor a repository or execute fixes.

## Local verification

From a source checkout with Node 24, open PowerShell at the repository root. Run each line separately in the same window and stop on any error. Each successfully started npm command below must finish with exit 0.

1. Install the locked dependency:

   ```powershell
   npm.cmd ci --ignore-scripts
   $LASTEXITCODE
   ```

2. Explicitly prepare the pinned dependency metadata and tarball in the same npm cache:

   ```powershell
   npm.cmd cache add yaml@2.9.0 --ignore-scripts --no-audit --no-fund
   $LASTEXITCODE
   ```

   This is connected setup. `npm ci` can cache the lockfile's resolved tarball without the registry metadata that a fresh offline tarball install also needs. Keep the same cache configuration for all three steps.

3. Run the complete tests:

   ```powershell
   npm.cmd test
   $LASTEXITCODE
   ```

The installed-package test obtains npm's CLI path from `npm test`, creates a fresh tarball, checks its exact eight-member list (including `LICENSE`), and installs offline into a separate temporary prefix. Running that test directly with `node --test` is unsupported and gives a clear instruction to use `npm test`. These connected preparation steps do not change the installed demo's offline-runtime requirements described above.

The test retains temporary artifacts and performs no online install fallback. `npm run pack:check` prints the dry-run manifest; the installed-package test performs the actual membership and runtime assertions. CI evidence applies only to its exact source commit and runner; a new candidate needs its own evidence.

## Build from source and contribute

Use the [source build guide](https://github.com/nowwcastle-sudo/gategraph-ci/blob/main/docs/release/public-candidate.md) for a clean checkout, exact eight-file archive, checksum, offline install and synthetic demo. The source archive and installable TGZ are different artifacts.

Read [CONTRIBUTING](https://github.com/nowwcastle-sudo/gategraph-ci/blob/main/CONTRIBUTING.md), [SECURITY](https://github.com/nowwcastle-sudo/gategraph-ci/blob/main/SECURITY.md), and [CODE_OF_CONDUCT](https://github.com/nowwcastle-sudo/gategraph-ci/blob/main/CODE_OF_CONDUCT.md). Use synthetic reproductions and redact real repository evidence.

Public availability does not establish demand, paid adoption, or production readiness. Hosted operation, automatic remediation and any GitHub write surface require a separate reviewed design.

To update, install a verified newer TGZ into a fresh prefix and select its executable explicitly. To roll back, use the retained previous prefix or reinstall its verified TGZ into another fresh prefix. Keep failed prefixes and reports until reviewed.
