# GateGraph CI

[English](https://github.com/nowwcastle-sudo/gategraph-ci/blob/main/README.md) | [한국어](https://github.com/nowwcastle-sudo/gategraph-ci/blob/main/README.ko.md)

GateGraph CI is an experimental, read-only diagnostic CLI for inspecting GitHub merge-gate evidence. It does not enforce merge policy or prove that a repository is safe. Maintainer adoption and production suitability remain unverified.

Use it to investigate whether a job that should block a merge can fail while GitHub's required checks still pass. A *required context* is the exact check name a branch rule requires; a *voting job* is a job whose failure is intended to block merging. GateGraph compares workflow jobs, observed check runs, current branch rules and explicit policy to find gaps between those two things.

License: Apache License 2.0. See [LICENSE](LICENSE).
Source: [nowwcastle-sudo/gategraph-ci](https://github.com/nowwcastle-sudo/gategraph-ci), branch `main`.
Public release: `v0.2.0-experimental.2`; package: `gategraph-ci@0.2.0-experimental.2`.
The package stays `private: true` to prevent accidental npm publication; public source and GitHub release downloads do not require an npm publication.

The published `v0.2.0-experimental.2` package contains 12 files, including `README.ko.md` and the runtime modules. The `v0.2.0-experimental.1` archive remains an eight-file historical release with its original checksum and without the Korean edition.

The `.2` release supports `--explain` and `compare`. The historical `.1` download does not.

## What the commands do

| Command or input | Behavior and boundary |
|---|---|
| `demo` | Analyze invented evidence with the real audit core. Defaults to `finding`; no account or network is needed after installation. |
| `demo --scenario NAME` | Choose `finding`, `policy-review`, `unknown` or `collection-error` to inspect each report status. |
| `audit --repo OWNER/NAME --sha SHA` | Collect workflows at a full 40-character commit SHA, observed Actions runs/jobs/checks, and current rulesets and classic branch protection. Emit one JSON report. |
| `--run-id ID` | Select a positive integer run ID. Repeat for multiple workflows; IDs must be unique, and exactly one completed run per selected workflow is allowed. |
| `--target-ref refs/heads/BRANCH` | Assert the branch target already established by run evidence. It cannot invent a missing target. |
| Workflow selection | Use `--run-id`; there is no workflow-path CLI option. Excluded runs and workflow paths appear in `provenance.scope`. Active required contexts still apply. |
| `--policy-file FILE` | Read a local strict JSON policy of at most 64 KiB. Requires `--target-ref` and at least one `--run-id`; bind the policy to the exact observed run attempt. |
| `--explain` | Add a complete, bounded coverage snapshot and review-only suggestions to `audit` or `demo`. Default output is unchanged. |
| `compare --before FILE --after FILE` | Read two saved local JSON reports, validate snapshots and compare observation-time coverage. No GitHub collection or file writes. |
| `--help`, `demo --help`, `audit --help` | Print usage text without collecting evidence. |
| `--version` | Print the installed package name and version. |

Audit options can be reordered. Only `--run-id` may repeat. Unrecognized options, duplicate singleton options and invalid values exit `1`.

`compare` exits `0` for valid comparable reports, even when changes exist; it exits `4` for invalid or incomparable evidence and `1` for usage or unexpected failures. A disappeared finding is not proof of repair. A snapshot digest checks internal consistency, not who produced the file. Current ruleset observations do not prove what the control plane was at an earlier commit. See [local coverage and comparison](https://github.com/nowwcastle-sudo/gategraph-ci/blob/main/docs/local-coverage.md) for working commands, input ceilings and interpretation.

From a current source checkout with dependencies installed, this synthetic no-drift example saves one fresh report and compares it with itself. Run the PowerShell lines in order:

```powershell
$gategraphSaved = Join-Path ([IO.Path]::GetTempPath()) ('gategraph-snapshot-' + [guid]::NewGuid().ToString('N') + '.json')
node ./bin/gategraph.mjs demo --explain | Out-File -LiteralPath $gategraphSaved -Encoding utf8 -NoClobber -ErrorAction Stop
$gategraphLocalDemoExit = $LASTEXITCODE
if ($gategraphLocalDemoExit -ne 2) { throw 'Expected synthetic finding exit 2; retain the report.' }
node ./bin/gategraph.mjs compare --before $gategraphSaved --after $gategraphSaved
$gategraphCompareExit = $LASTEXITCODE
if ($gategraphCompareExit -ne 0) { throw 'Comparison unavailable; retain the report.' }
```

Workflow parsing and name expansion have [local resource ceilings](https://github.com/nowwcastle-sudo/gategraph-ci/blob/main/docs/runtime-resource-limits.md). Exceeding them returns `WORKFLOW_RESOURCE_LIMIT_EXCEEDED` as a collection error. These are analyzer limits, not GitHub Actions validity rules or whole-process memory/time guarantees.

## Download the experimental release anonymously

The `v0.2.0-experimental.2` assets are published. Use Node.js 24 and npm. In PowerShell, run each line in the same session.
No GitHub sign-in is needed for published public assets. Stop on a failed download
or checksum mismatch and retain the directory; never overwrite an old artifact.

```powershell
$ErrorActionPreference = 'Stop'
$gategraphAssets = Join-Path ([IO.Path]::GetTempPath()) ('gategraph-release-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $gategraphAssets -ErrorAction Stop | Out-Null
$gategraphRelease = 'https://github.com/nowwcastle-sudo/gategraph-ci/releases/download/v0.2.0-experimental.2'
$gategraphTarball = Join-Path $gategraphAssets 'gategraph-ci-0.2.0-experimental.2.tgz'
Invoke-WebRequest -Uri ($gategraphRelease + '/gategraph-ci-0.2.0-experimental.2.tgz') -OutFile $gategraphTarball
Invoke-WebRequest -Uri ($gategraphRelease + '/gategraph-ci-0.2.0-experimental.2.tgz.sha256') -OutFile ($gategraphTarball + '.sha256')
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

On Windows, use `npm.cmd` so PowerShell does not resolve `npm` to an execution-policy-blocked `npm.ps1`.
Each temporary install directory keeps this attempt separate from previous installs. Preserve it and its logs until the result is reviewed; use a fresh directory for another attempt.
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

Exit `0` can mean that no uncovered path was proven within the supplied evidence, or that a job is explicitly advisory. It does not establish coverage for every possible failure or authenticate the policy author's intent. Read `results` and their reason codes alongside the top-level status; retain the report's `subject` and `provenance` so another reader can identify its scope.

## Live audits and explicit selection

Live audits additionally need an authenticated GitHub CLI (`gh`) and read permission for the target's Actions, contents, rulesets, and protection evidence. These command shapes use placeholders; substitute coordinates from an observed run before a live invocation:

Install GitHub CLI using its [official installation instructions](https://cli.github.com/manual/installation), then authenticate using [gh auth login](https://cli.github.com/manual/gh_auth_login). The account must be able to read the selected repository and every required endpoint, including check runs and branch protection. Successful sign-in alone does not establish those permissions; organization restrictions and token type can affect access. GateGraph does not request or upgrade permissions. Obtain the full SHA, completed run IDs and target branch from the repository's Actions run details before replacing the placeholders below.

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

| Stage | Network and local-file scope |
|---|---|
| Download and dependency preparation | Read public GitHub release assets and the npm registry; write the new download directory and explicit npm cache. |
| Offline install | Read the verified TGZ and prepared cache; write a new local install prefix and npm logs. Lifecycle scripts are disabled. |
| Installed demo | Use bundled synthetic data and write JSON to stdout. The documented PowerShell redirection creates a fresh local report file. |
| Live audit | Invoke authenticated `gh` for allowlisted GET requests to repository metadata, the Git tree, workflow contents, Actions runs/jobs, check runs, rulesets and branch protection. Read a local policy file only when requested; write the report to stdout. |

Reports can contain repository names, SHAs, branch names and run/workflow identities. Review them before sharing. Authentication belongs to GitHub CLI; do not put tokens in a policy file or issue report.

## Supported workflow subset and limits

The `.2` release parses workflow text as data. It supports static job names (falling back to job IDs), explicit acyclic `needs` dependencies, and up to four static matrix axes with at most 128 combinations in total. Values must be scalar strings, numbers or booleans; every axis must appear as `matrix.KEY` in the job name, and expanded names must be unique. A job-level condition, when present, must be the literal `always()`. The historical `v0.2.0-experimental.1` download supports only one axis.

Reusable-workflow jobs (`jobs.<id>.uses`), job-level `continue-on-error`, dynamic or include/exclude matrices, other job-name expressions and other job conditions are outside this subset. Unsupported or ambiguous evidence returns `collection-error`; the tool does not evaluate arbitrary Actions expressions or execute shell steps to discover behavior. Trigger names are parsed, but GateGraph is not a full event/path-condition simulator.

| Local analyzer resource | Ceiling |
|---|---:|
| UTF-8 text per workflow / all workflows | 1 MiB / 4 MiB |
| Jobs per workflow | 128 |
| Declared job-name length | 1,024 |
| Static matrix axes in the `.2` release | 4 |
| Total matrix combinations per job | 128 |
| Values per supported matrix axis | 128 |
| Matrix value length after string conversion | 256 |
| One expanded check-name length | 2,048 |
| Combined expanded check-name lengths per audit | 65,536 |

Name lengths use JavaScript string length. Exceeding a ceiling stops the entire analysis with `WORKFLOW_RESOURCE_LIMIT_EXCEEDED`, with no partial findings. These limits also apply to workflows without a matching observed run. Narrowing run selection may reduce scope; it never removes active required contexts or proves excluded workflows safe. See [runtime resource limits](docs/runtime-resource-limits.md) for the full contract.

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

The installed-package test obtains npm's CLI path from `npm test`, creates a fresh tarball, checks its exact twelve-member list (including `LICENSE` and `README.ko.md`), and installs offline into a separate temporary prefix. Running that test directly with `node --test` is unsupported and gives a clear instruction to use `npm test`. These connected preparation steps do not change the installed demo's offline-runtime requirements described above.

The test retains temporary artifacts and performs no online install fallback. `npm run pack:check` prints the dry-run manifest; the installed-package test performs the actual membership and runtime assertions. CI evidence applies only to its exact source commit and runner; a new candidate needs its own evidence.

## Build from source and contribute

Use the [source build guide](https://github.com/nowwcastle-sudo/gategraph-ci/blob/main/docs/release/public-candidate.md) for a clean checkout, exact twelve-file archive, checksum, offline install and synthetic demo. The source archive and installable TGZ are different artifacts.

Read [CONTRIBUTING](https://github.com/nowwcastle-sudo/gategraph-ci/blob/main/CONTRIBUTING.md), [SECURITY](https://github.com/nowwcastle-sudo/gategraph-ci/blob/main/SECURITY.md), and [CODE_OF_CONDUCT](https://github.com/nowwcastle-sudo/gategraph-ci/blob/main/CODE_OF_CONDUCT.md). Use synthetic reproductions and redact real repository evidence.

Public availability does not establish demand, paid adoption, or production readiness. Hosted operation, automatic remediation and any GitHub write surface require a separate reviewed design.

To update, install a verified newer TGZ into a fresh prefix and select its executable explicitly. To roll back, use the retained previous prefix or reinstall its verified TGZ into another fresh prefix. Keep failed prefixes and reports until reviewed.
