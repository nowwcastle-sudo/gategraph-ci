# Contributing

GateGraph CI welcomes issues and pull requests for its experimental read-only
scope at https://github.com/nowwcastle-sudo/gategraph-ci. Use synthetic
reproductions; report vulnerabilities through SECURITY.md.

## Before a change

- Read `CONTEXT.md`, the README and source build guide, and the relevant ADR first.
- Use synthetic fixtures only. Never commit tokens, private workflow files, or
  customer repository identifiers.
- Keep the read-only GitHub boundary and fixed status/exit contracts intact.

## Verification

From the repository root with Node 24:

```powershell
npm.cmd ci --ignore-scripts
$gategraphCiExit = $LASTEXITCODE
if ($gategraphCiExit -ne 0) { throw 'Dependency installation failed; stop and preserve logs.' }
npm.cmd cache add yaml@2.9.0 --ignore-scripts --no-audit --no-fund
$gategraphCacheExit = $LASTEXITCODE
if ($gategraphCacheExit -ne 0) { throw 'Offline dependency cache preparation failed; stop.' }
npm.cmd test
$gategraphTestExit = $LASTEXITCODE
if ($gategraphTestExit -ne 0) { throw 'Verification failed; preserve its output.' }
```

Use the same npm cache configuration for these commands. The installed-package
test needs both the pinned yaml tarball and registry metadata; npm ci alone
does not establish that offline-install prerequisite. This is explicit
connected preparation, not permission for a hidden online fallback.

Record native exits and keep any RED artifact. Relaxing a test is not a product
fix.

## Review

Describe the user-visible contract, affected evidence scope, and rollback path.
Do not publish to npm, change repository visibility, or add GitHub write
operations without a separate owner decision. The source is licensed under
Apache License 2.0; see [`LICENSE`](LICENSE).
