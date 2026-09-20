# Repository guidance

GateGraph CI is experimental, read-only OSS. Read CONTEXT.md before domain changes, docs/adr/ before changing evidence semantics, and CONTRIBUTING.md before preparing a contribution.

Keep VERIFIED (observed evidence), INFERENCE (derived conclusions), and UNKNOWN (unestablished intent or coverage) distinct. Non-voting or non-required jobs are not automatic defects. A finding requires an active gate and a proven uncovered voting failure path. Missing or unsupported evidence remains collection-error.

Preserve allowlisted GET-only collection, untrusted-text handling, resource limits, exact policy coordinates and status/exit contracts. Never execute workflow text or infer aggregate propagation from ancestry. Changes to GitHub state require separate authorization.

Use synthetic fixtures and preserve license attribution. Runtime identity changes must update package metadata, adapter/core identities and existing fixture expectations together. README and the source build guide define the eight-file package contract; private npm metadata prevents accidental registry publication.
