# Repository guidance

GateGraph CI is experimental, read-only OSS. Read CONTEXT.md before domain changes, docs/adr/ before changing evidence semantics, and CONTRIBUTING.md before preparing a contribution.

Keep VERIFIED (observed evidence), INFERENCE (derived conclusions), and UNKNOWN (unestablished intent or coverage) distinct. Non-voting or non-required jobs are not automatic defects. A finding requires an active gate and a proven uncovered voting failure path. Missing or unsupported evidence remains collection-error.

Preserve allowlisted GET-only collection, untrusted-text handling, resource limits, exact policy coordinates and status/exit contracts. Never execute workflow text or infer aggregate propagation from ancestry. Changes to GitHub state require separate authorization.

Use synthetic fixtures and preserve license attribution. Runtime identity changes must update package metadata, adapter/core identities and existing fixture expectations together. Before changing packaging, compare `package.json`, `test/installed-package.test.mjs`, and `docs/release/public-candidate.md`; current candidate members and historical release members differ. Private npm metadata prevents accidental registry publication. (2026-09-20: local completion adds runtime modules.)
