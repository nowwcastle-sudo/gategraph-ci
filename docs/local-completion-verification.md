# Local completion verification — current source candidate

This table maps approved requirements to source and runnable evidence. Counts and exits are filled from this candidate's local checks; unexecuted external checks remain explicitly open. Synthetic fixtures do not establish live adoption or private-repository operation.

| Requirement | Source and behavior | Local evidence | Result |
|---|---|---|---|
| GG-L04 static multi-axis matrix (Task 1) | `src/static-matrix.mjs`, `src/audit-control-plane.mjs`; 2/3/4 axes, collisions and 128-cell ceiling | Task 1 report: `node --test test/local-matrix.test.mjs test/matrix-resource-limits.test.mjs test/residual-correctness.test.mjs`, exit 0; Task 2 review-fix scoped six-file command, 77/77, exit 0 | Locally verified at Task 1/2 revisions; final full suite below is the current-revision gate. |
| GG-L01 coverage explanation (Task 2) | `src/coverage-snapshot.mjs`, `src/audit-control-plane.mjs`; direct, evidence-backed aggregate, uncovered and unknown/advisory | Task 2 report: scoped 59/59, exit 0; review-fix scoped 77/77, exit 0 | Locally verified at Task 2 revision; final full suite below is the current-revision gate. |
| GG-L03 review-only suggestions (Task 2) | `src/audit-control-plane.mjs`; finding coordinates, prerequisites and `reaudit_required` | Task 2 report: scoped 59/59, exit 0; review-fix scoped 77/77, exit 0 | Locally verified at Task 2 revision; no automated change path. |
| GG-L02 local drift (Task 3) | `src/report-input.mjs`, `src/coverage-snapshot.mjs`, `bin/gategraph.mjs`; all seven change kinds and comparable/unavailable exits | `node --test test/local-comparison.test.mjs test/cli.test.mjs`: 23/23, exit 0; `npm test`: 290/290, exit 0 | Locally verified with synthetic saved observations. |
| GG-L05 comparison and permission failure explanation (Task 3) | strict saved-reader/invalid-snapshot codes; existing GET collector retains 404/permission collection-error | Same 23/23 and 290/290 commands, exit 0; existing GET/404 regressions included in full suite | Local failure paths verified; live permission scope unexecuted. |

## Final candidate checks

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
