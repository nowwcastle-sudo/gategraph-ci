# GateGraph Local Explanation and Drift Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Explain every bounded producer's coverage, compare saved observations, offer review-only suggestions and support conservative static multi-axis matrices.

**Architecture:** Extend the existing audit at its validated job-instance/coverage boundary, not by re-parsing workflows in a second analyzer. Isolate static matrix expansion, snapshot serialization/comparison and strict local JSON reading in small modules. Explain remains opt-in; compare never invokes GitHub collection.

**Tech Stack:** Node.js 24, existing yaml 2.9.0, node:test, existing GET-only gh adapter.

**Spec:** `docs/superpowers/specs/2026-09-20-local-completion-design.md` (approved 2026-09-20).

## Global Constraints

- Preserve audit/demo status/exit contracts and single-axis behavior. No GitHub writes, automatic YAML edits, new runtime dependencies, hosted service or npm publication.
- Multi-axis: at most 4 literal scalar axes and 128 cells; retain existing per-axis/string/expanded-character limits. Reject include/exclude/dynamic/reusable/ambiguous joins.
- Snapshot: 4096 producers, 16384 edges, 1 MiB UTF-8 serialized size. Incomplete requested explanation is collection-error, never complete partial output.
- Compare: explicit local JSON, 8 MiB each; duplicate keys/schema/digest/depth/type/item violations fail closed. Output only stdout; no input modifications.
- Digest establishes consistency, not source authentication. Live current rulesets are not historical configuration proof.
- Back up edited files outside package source; apply ponytail full/karpathy-guidelines and verify Node/yaml API details with Context7 or official docs. Tests precede credential scan and commit. Retain failures and immutable release assets.

## Review Focus

1. Axis values `1` and `'1'` stringify to the same check name: reject ambiguity rather than merging cells (Task 1).
2. Required context and producer with same display name but different provider/workflow are not interchangeable (Task 2).
3. Required aggregate with dependencies but without all-needs failure evidence is not protective (Task 2).
4. Timestamp/order-only differences are not policy drift; scope/ref changes are not comparable (Task 3).
5. Duplicate escaped keys/deep JSON/forged consistent digests cannot imply authenticity or bypass limits (Task 3).

## File/interface map

Create `src/static-matrix.mjs` for bounded expansion; `src/coverage-snapshot.mjs` for canonical snapshots and drift; `src/report-input.mjs` for strict local parsing. Keep finding generation and suggestions in `src/audit-control-plane.mjs` so they use the exact accepted evidence coordinates. CLI owns only dispatch/exit/output. No modification to GET endpoint allowlist.

## Task 1: Bounded static matrix cells

**Files:** Create `src/static-matrix.mjs`, `test/local-matrix.test.mjs`; modify `src/audit-control-plane.mjs` normalizedJob and jobInstances; retain existing `test/matrix-resource-limits.test.mjs`.

**Interfaces:** `expandStaticMatrix(job: object, limits: {maxValues:number,maxValueLength:number,maxNameLength:number,maxExpandedChars:number}, budget: {expandedChars:number}) -> {cells:Array<{axes:Record<string,string|number|boolean>,checkName:string}>} | {error:'unsupported'|'resource-limit'}`. Validate before updating mutable budget. normalizedJob gains `cells` while preserving `checkNames`; instances gain `axes`.

- [ ] Add failing tests:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {expandStaticMatrix} from '../src/static-matrix.mjs';
const limits = {maxValues:128,maxValueLength:256,maxNameLength:1024,maxExpandedChars:65536};
test('all axes participate in unique literal names', () => {
  const result = expandStaticMatrix({name:'test (${{ matrix.os }}, ${{ matrix.node }})',
    strategy:{matrix:{os:['win','linux'],node:[22,24]}}}, limits, {expandedChars:0});
  assert.equal(result.cells.length, 4);
  assert.deepEqual(result.cells[0].axes, {os:'win',node:22});
});
test('stringified scalar collision fails', () => {
  assert.equal(expandStaticMatrix({name:'${{ matrix.x }}-${{ matrix.y }}',
    strategy:{matrix:{x:[1,'1'],y:['a']}}}, limits, {expandedChars:0}).error, 'unsupported');
});
```

- [ ] Run `node --test test/local-matrix.test.mjs`; initial failure must be missing module. Confirm current constant values at implementation; production passes existing ceilings, not the example test limits.
- [ ] Implement by validating plain job/strategy/matrix shapes; preserve existing no-strategy literal name case. Sort axis keys for stable cell identity, preserve each axis's declared value order, reject nonfinite numbers/null/objects/empty axes; multiply lengths with checked integer bounds before enumeration. Require template expression keys equal declared axes; permit only recognized matrix substitutions and no leftover `${{`. Keep the old single-axis accepted subset.

```js
let cells = [{axes:{},checkName:''}];
for (const axis of axisKeys) {
  cells = cells.flatMap(cell => matrix[axis].map(value => ({
    axes:{...cell.axes,[axis]:value},checkName:''
  })));
}
```

Here `axisKeys` and `matrix` are locally validated values inside expandStaticMatrix. Calculate all expanded names and total lengths before returning cells/updating budget. Duplicate names return unsupported. Map helper errors to the existing core unsupported/resource-limit outcomes, never exceptions or truncated output.
- [ ] Integrate at normalizedJob without relaxing needs/condition/uses/continue-on-error checks. Build jobInstances from cells and retain checkName unique joins to observed checks. Add end-to-end fixtures by cloning createDemoInput and replacing workflow text/checkRuns with matching 2/3/4-axis job cells; include missing observed cell and provider collision.
- [ ] Test 128 exact/129+, 5 axes, repeated axis tokens, omitted axis, dynamic value, include/exclude, duplicate values, finite/nonfinite numbers, expanded-string limits and unchanged budget on rejection. Run `node --test test/local-matrix.test.mjs test/matrix-resource-limits.test.mjs test/residual-correctness.test.mjs`; require exit 0. Credential-scan staged files, then `git add src/static-matrix.mjs src/audit-control-plane.mjs test/local-matrix.test.mjs`; `git commit -m "feat: support bounded static multi-axis checks"`.

## Task 2: Complete opt-in coverage snapshot and review suggestions

**Files:** Create `src/coverage-snapshot.mjs`, `test/local-coverage.test.mjs`; modify `src/audit-control-plane.mjs`, `bin/gategraph.mjs`, `test/cli.test.mjs`.

**Interfaces:** `auditControlPlane(input: object, options?: {explain?:boolean}) -> object` preserves default output. `canonicalDigest(value: object) -> string`; `buildCoverageSnapshot(model: object) -> object` throws RangeError only on model ceilings. Model exact keys: `repository,sourceSha,targetRef,analysisContract,scope,workflows,producers,gates,edges,links,policyFingerprint,observation`. All passed from the existing validated core, not untrusted input directly.

Model schema: scope sorted workflow paths; workflows `{path,digest}` with digest of actual workflow bytes; producers `{id,workflowPath,jobId,axes,checkName,provider,policy,coverage}`; gates `{id,workflowPath,jobId,checkName,provider,sources}`; edges `{workflowPath,fromJobId,toJobId}`; links `{producerId,gateId,kind:'direct'|'aggregate',evidence}`. `id=canonicalDigest([workflowPath,jobId,axes,provider])` for producers; gate ID includes context/provider. coverage is `direct|required-aggregate|uncovered|advisory|unknown`; policy separately `voting|advisory|unknown`. Direct/aggregate structural coverage takes precedence; uncovered producers use policy to distinguish advisory/unknown. observation contains source SHA, analyzedAt and existing bounded source/run provenance, explicitly labelled observation-time evidence. Snapshot adds `schema='gategraph-coverage/1',complete=true,digest` (digest excludes itself).

- [ ] Add failing opt-in invariance test:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {auditControlPlane} from '../src/audit-control-plane.mjs';
import {createDemoInput} from '../src/demo-evidence.mjs';
test('explanation preserves findings and includes covered jobs', () => {
  const input = createDemoInput('finding');
  const plain = auditControlPlane(input);
  const explained = auditControlPlane(input,{explain:true});
  assert.deepEqual(explained.results,plain.results);
  assert.equal(explained.status,plain.status);
  assert.equal(explained.coverageSnapshot.producers.length,3);
  assert.equal(explained.coverageSnapshot.complete,true);
  assert.equal(explained.suggestions.every(s => s.requires_review === true),true);
});
```

- [ ] Run `node --test test/local-coverage.test.mjs`; expected missing coverageSnapshot.
- [ ] Extract explanation model immediately after gateCoverage and policy normalization, before covered-producer filtering. Use every jobInstance, direct resolvedGates equality and only proven gateCoverage ancestors. Emit needs edges once per job, not exponential paths. Policy fingerprint hashes normalized voting and gate-propagation policy, excluding retrieval timestamps/run-order noise; preserve policy-input's existing binding checks. Sort canonical arrays by identity, object keys recursively for digest; reject unsupported values, never JSON-round unsupported data.

```js
const snapshot = {...model, schema:'gategraph-coverage/1', complete:true};
snapshot.digest = canonicalDigest(snapshot);
if (Buffer.byteLength(JSON.stringify(snapshot),'utf8') > 1024*1024) {
  throw new RangeError('COVERAGE_RESOURCE_LIMIT');
}
```

- [ ] On explain-only ceiling failure return existing collectionError shape with explicit `COVERAGE_RESOURCE_LIMIT`, no complete snapshot; normal audit remains unchanged. For any earlier collection error, no complete snapshot/suggestions. Suggestions emitted only for actual `finding` results in a separate `suggestions` array, not by mutating results. Each has `requires_review:true, kind:'review-required-context'|'review-aggregate-propagation', coordinates, prerequisites, reaudit_required:true`. Use exact existing finding evidence coordinates; aggregate suggestion only same-workflow candidate. Never recommend changing voting to advisory.
- [ ] Add boolean `--explain` to audit and demo parser; duplicate/valued flag rejected; preserve repeated --run-id and all legacy error exits. Forward second audit argument only when requested, preserving existing injected audit test dependencies. Show new option in help; do not add a network call.
- [ ] Test all coverage categories, partial matrix cells, two providers/workflows same name, missing aggregate evidence, 4096/4097 producers, 16384/16385 edges, 1 MiB boundary, deep chain with no all-path enumeration, core input immutability, byte-identical default report, suggestion coordinates/no writes. Run `node --test test/local-coverage.test.mjs test/cli.test.mjs test/final-review-core.test.mjs test/gh-adapter.test.mjs`; require exit 0. Scan credentials then `git add src/coverage-snapshot.mjs src/audit-control-plane.mjs bin/gategraph.mjs test/local-coverage.test.mjs test/cli.test.mjs`; `git commit -m "feat: explain coverage with review-only suggestions"`.

## Task 3: Strict local drift comparison and package closure

**Files:** Create `src/report-input.mjs`, `test/local-comparison.test.mjs`; modify `src/coverage-snapshot.mjs`, `bin/gategraph.mjs`, `test/cli.test.mjs`, `package.json`, `test/installed-package.test.mjs`, `README.md`, `README.ko.md`; create `docs/local-coverage.md`, `docs/local-completion-verification.md`.

**Interfaces:** `readSavedReport(path: string) -> Promise<object>` rejects Error with fixed code message; `parseSavedReport(text: string) -> object`; `compareCoverage(beforeReport: object, afterReport: object) -> {comparable:boolean,changes:object[],before:object|null,after:object|null,unresolved:string[]}`. Pure comparison validates snapshots/digests itself, even for direct API calls. CLI `compare --before FILE --after FILE` exits 0 comparable (with or without changes), 4 comparison-unavailable/invalid saved evidence, 1 usage/unexpected failure. Never use finding disappearance as resolution.

- [ ] Add failing tests:

```js
const before = auditControlPlane(createDemoInput('finding'),{explain:true});
const after = structuredClone(before);
after.coverageSnapshot.observation.analyzedAt = '2026-09-21T00:00:00Z';
delete after.coverageSnapshot.digest;
after.coverageSnapshot.digest = canonicalDigest(after.coverageSnapshot);
assert.deepEqual(compareCoverage(before,after).changes,[]);
assert.equal(compareCoverage(before,{version:1,status:'unknown',results:[]}).comparable,false);
assert.throws(() => parseSavedReport('{"version":1,"\\u0076ersion":1}'));
```

Put assertions in node:test cases with explicit imports of auditControlPlane, createDemoInput, canonicalDigest, compareCoverage and parseSavedReport from their owning files.
- [ ] Run `node --test test/local-comparison.test.mjs`; initial failure must reflect missing parser/comparison exports.
- [ ] Implement bounded strict JSON preflight tokenizer before JSON.parse: stack depth <=32, <=200000 values, <=50000 entries per array; scan strings with JSON escape rules, decode object keys and maintain per-object Set for duplicate detection. Validate token grammar, reject trailing text/nonfinite values and invalid unicode escapes. Do not use a duplicate-key regex. Read one regular-file handle with limit+1 bytes and compare fstat/path identity before/after; refuse symlink/reparse paths and nonregular inputs. No output writes.
- [ ] Validate exact snapshot schema/model keys, array bounds, enums, unique IDs, gate references, SHA/digest types and digest recomputation. Compare requires non-collection-error complete evidence, equal repository/ref/scope/analysisContract. Imported schema/digest validation does not authenticate producer. Return explicit unresolved codes for legacy/incomplete/mismatch/invalid cases and no changes claimed resolved.
- [ ] Compare sorted identity maps: producers/gates added or removed; policyFingerprint changed; matched producer coverage/links changed; workflow digest changed. Keep before/after sourceSHA and observation provenance, ignore analyzedAt/run order as drift. `changes` kinds are `producer-added|producer-removed|gate-added|gate-removed|policy-changed|coverage-changed|workflow-changed`. Removed producer is not repaired producer. Do not infer historical control-plane state from either SHA.
- [ ] Add tests for every change kind; SHA-only reobservation; timestamp/run order; wrong ref/scope/contract; malformed digest; valid forged digest with authenticity disclaimer; duplicate escaped keys; 8 MiB/over, depth/node ceilings; legacy report; collection-error side; no collectWithGh call for compare; input hashes unchanged. Run `node --test test/local-comparison.test.mjs test/cli.test.mjs` and require exit 0.
- [ ] Add exactly `src/static-matrix.mjs`, `src/coverage-snapshot.mjs`, `src/report-input.mjs` to package.files and exact installed-package member assertions. New candidate 12 files: previous 9 (including automatic README.ko.md) plus 3 modules. Preserve historical 8-file release. Run actual offline-installed demo --explain and compare using captured synthetic reports; don't count source execution as installed-package proof.
- [ ] Document working commands, coverage vs safety, observation-time drift, review-only suggestions, input limits and no-authentication caveat in both READMEs and docs/local-coverage.md. Apply humanize-korean/no-ai-slop before changing Korean copy. Fill requirement evidence table GG-L04 -> Task 1, GG-L01/03 -> Task 2, GG-L02/05 -> Task 3 with actual source, command/count/exit/result; explicitly mark unexecuted cases.
- [ ] Run `npm test`, `npm run pack:check`, existing installed-package offline suite and `npm audit --omit=dev`; retain per-command exit and results. Audit advisory/failure is a blocker to examine, not permission to upgrade deps. Remote two-Windows CI still needs separate observed results after authorized publication. Scan staged credentials then `git add src bin test package.json README.md README.ko.md docs/local-coverage.md docs/local-completion-verification.md`; `git commit -m "feat: compare bounded coverage snapshots locally"` only after local checks pass.

## Self-review / execution boundary

All GG-L01–05 and five Review Focus cases have owners above. Default findings remain unchanged; explain-only resource failures are the documented exception in status. Every new runtime module is explicitly packaged. No new tests, implementation, remote CI or live-private-repository proof exists merely because this plan exists. Plan review/execution selection precedes implementation; external evidence integrations require a demonstrated gap and named coordinates/permissions.
