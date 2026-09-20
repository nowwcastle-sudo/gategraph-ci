# Local coverage explanation and comparison

This describes the current source candidate, not the immutable `v0.2.0-experimental.1` release archive. Use Node.js 24 in a checkout with the pinned dependency installed, or use a newly packed and installed candidate. The synthetic demo needs no GitHub account or network at runtime.

Run each PowerShell line in the checkout root. The first command intentionally exits `2`: its synthetic fixture contains a finding. The saved JSON files are new; no earlier report is overwritten.

```powershell
$gategraphBefore = Join-Path (Get-Location) ('gategraph-before-' + [guid]::NewGuid().ToString('N') + '.json')
$gategraphAfter = Join-Path (Get-Location) ('gategraph-after-' + [guid]::NewGuid().ToString('N') + '.json')
$gategraphJson = & node ./bin/gategraph.mjs demo --explain
$gategraphDemoExit = $LASTEXITCODE
if ($gategraphDemoExit -ne 2) { throw 'Expected synthetic finding exit 2; do not compare this output.' }
$gategraphJson | Out-File -LiteralPath $gategraphBefore -Encoding utf8 -NoClobber -ErrorAction Stop
$gategraphJson | Out-File -LiteralPath $gategraphAfter -Encoding utf8 -NoClobber -ErrorAction Stop
& node ./bin/gategraph.mjs compare --before $gategraphBefore --after $gategraphAfter
$gategraphCompareExit = $LASTEXITCODE
if ($gategraphCompareExit -ne 0) { throw 'Comparison unavailable; keep both input reports.' }
```

Comparing identical reports yields `comparable: true` and `changes: []`. For a real comparison, save two independently produced `audit --explain` JSON reports and pass their paths to `compare`. Both must have complete snapshots for the same repository, target ref, workflow scope and analysis contract. A different source SHA is allowed and retained as an observation coordinate. A `collection-error` side, legacy report without a snapshot, invalid digest or mismatched comparison scope returns `comparable: false`, an `unresolved` code and exit `4`. Usage or unexpected failures exit `1`. The command emits one JSON result to stdout; the caller decides whether and where to save it.

The snapshot separates producer policy (`voting`, `advisory`, `unknown`) from observed coverage (`direct`, `required-aggregate`, `uncovered`, `advisory`, `unknown`). Each gate keeps its required `requiredIntegrationId` selector (`null` means any provider) separate from the observed check `provider`; a pinned and wildcard requirement for the same check remain distinct gates. A required aggregate needs explicit `all-needs` failure-propagation evidence. Dependency ancestry alone does not prove protection. Findings remain the audit result; suggestions are review-only and require a new audit after any human change. No YAML patch or GitHub write is performed.

Comparison reports producer and gate additions/removals, a changed policy fingerprint, changed producer coverage or gate links, and changed workflow content digest. A removed producer is **not** a repaired producer. Timestamp and run-order differences alone are not drift. Current rulesets observed in either report do not establish what the rules were at either source commit or between observations. `changes: []` means no modeled difference was found within the comparable saved evidence, not that merging is safe.

Each local input must be a regular, unchanged file of at most 8 MiB. The strict JSON reader rejects duplicate decoded object keys, malformed numbers/escapes/trailing data, depth above 32, more than 200,000 JSON values or more than 50,000 entries in an array. The snapshot itself is limited to 4,096 producers, 16,384 edges and 1 MiB serialized UTF-8. Unfinished explanation is a collection error, not a partial complete snapshot. A valid schema and digest establish internal consistency only: imported files and policy are not authenticated GitHub or maintainer evidence.
