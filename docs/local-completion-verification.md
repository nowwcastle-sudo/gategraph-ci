# Local completion verification — current source candidate

This table maps approved requirements to source and runnable evidence. Counts and exits are filled from this candidate's local checks; unexecuted external checks remain explicitly open. Synthetic fixtures do not establish live adoption or private-repository operation.

| Requirement | Source and behavior | Local evidence | Result |
|---|---|---|---|
| GG-L04 static multi-axis matrix (Task 1) | `src/static-matrix.mjs`, `src/audit-control-plane.mjs`; 2/3/4 axes, collisions and 128-cell ceiling | Task 1 report: `node --test test/local-matrix.test.mjs test/matrix-resource-limits.test.mjs test/residual-correctness.test.mjs`, exit 0; Task 2 review-fix scoped six-file command, 77/77, exit 0 | Locally verified at Task 1/2 revisions; final full suite below is the current-revision gate. |
| GG-L01 coverage explanation (Task 2) | `src/coverage-snapshot.mjs`, `src/audit-control-plane.mjs`; direct, evidence-backed aggregate, uncovered and unknown/advisory | Task 2 report: scoped 59/59, exit 0; review-fix scoped 77/77, exit 0 | Locally verified at Task 2 revision; final full suite below is the current-revision gate. |
| GG-L03 review-only suggestions (Task 2) | `src/audit-control-plane.mjs`; finding coordinates, prerequisites and `reaudit_required` | Task 2 report: scoped 59/59, exit 0; review-fix scoped 77/77, exit 0 | Locally verified at Task 2 revision; no automated change path. |
| GG-L02 local drift (Task 3) | `src/report-input.mjs`, `src/coverage-snapshot.mjs`, `bin/gategraph.mjs`; all seven change kinds and comparable/unavailable exits | `node --test test/local-comparison.test.mjs test/cli.test.mjs`: 23/23, exit 0; `npm test`: 290/290, exit 0 | Locally verified with synthetic saved observations. |
| GG-L05 comparison and permission failure explanation (Task 3) | strict saved-reader/invalid-snapshot codes; existing GET collector retains 404/permission collection-error | Same 23/23 and 290/290 commands, exit 0; existing GET/404 regressions included in full suite | Local failure paths verified; live permission scope unexecuted. |

## Initial Task 3 checks (historical)

| Check | Count / exit / artifact | Status |
|---|---|---|
| Focused comparison and CLI tests | 23 tests, 23 pass, 0 fail; exit 0 | Passed |
| `node --test test/documentation-contract.test.mjs` | 5 tests, 5 pass; exit 0. The example saved and compared strict JSON in pwsh (no BOM) and Windows PowerShell 5.1 (UTF-8 BOM). | Passed |
| `npm test` including actual offline installed-package exercise | 290 tests, 290 pass, 0 fail; exit 0 | Passed |
| `npm test -- test/installed-package.test.mjs` | 10 tests, 10 pass, 0 fail; exit 0; exact 12 members and isolated offline installed `demo --explain`/`compare`. Test-created tarball SHA-256: `b67fc92d0536e5e1d5890331ab02cdfbe1fb1e0e9ce9db4edda2071a04138f00`. | Passed |
| `npm run pack:check` with exact 12 members | `entryCount: 12`; exit 0 | Passed |
| `npm audit --omit=dev` | 0 vulnerabilities; exit 0 | Passed; no dependency change. |
| Remote two-Windows CI and live/private GitHub evidence | Not run | Requires separately authorized publication and identified evidence coordinates/permissions. |

The immutable historical release remains eight files; this current source candidate is twelve files. The source archive, installed package and any future remote run must be identified by their own commit/artifact hashes. A local pack or fixture test does not alter historical assets or prove remote CI.

## Final local review checkpoint

The consolidated fix at `28fd4d1c017e3b3095c0e0bf50c28fe6fa024280`
preserves required-provider selectors separately from observed providers.
Pinned-to-wildcard drift is visible; mixed pinned/wildcard requirements have
distinct gate identities and compare successfully to themselves. Both final
review findings were independently marked addressed, with no new
Critical/Important breakage.

| Check | Result | Source |
|---|---|---|
| `npm test` | 300 tests, 300 pass, 0 fail; exit 0 | Direct run at `d0204bae22a2ced518a22e67b53cf59e11e7dc89` on 2026-09-24. Local raw stdout log SHA-256 `2c69a13c2003b1393403597d39bbdf8eb207d3b056f60d7a6f5aeb85b8e0c3d9`. Earlier implementer report at `28fd4d1` remains separate. |
| Documentation contract | 6 tests, 6 pass; exit 0 | README correction `b53e5f2c19f28500f425fbcd52b7a03304a652a9`. |
| `npm test -- test/installed-package.test.mjs` | 10 tests, 10 pass; exit 0 | Fresh package after README correction; direct command log retained. |
| Candidate membership and offline use | Exact 12 members; installed demo/explain/compare and Windows command shim passed | Same fresh final package. |
| Dedicated static security diff review | Six changed source files reviewed; zero reportable findings; canonical coverage **partial** with one deferred discovery-accounting item | Sealed scan `b737fb57-5af6-453b-8311-d3db254711d4` at `28fd4d1`. |

Final candidate TGZ SHA-256:
`0d599a8358340c35f93c71774f4f3a5316a3a36137a402819ded237b7a8c29be`.
The README-only correction leaves `src`, `bin`, package metadata and lockfile
identical to the security-reviewed runtime. The complete suite was subsequently
rerun once at the current source head to preserve a direct final-source log.
README now distinguishes the source
candidate's four-axis/128-combination limit and 12-file package from the
older release. Previous artifact hashes above remain historical, not aliases
for this TGZ.

This static diff review does not establish every Windows race, host/`gh`
configuration, private repository integration or whole-process resource bound.
Remote two-Windows CI and new publication remain unexecuted. No GitHub write
path or npm publication was added.
