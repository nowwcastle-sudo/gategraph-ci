# ADR-0004: Bind explicit scope to observed runs

- Status: accepted
- Date: 2026-09-05
- Authority: owner-approved observed-run selection design

## Decision

Optional explicit run IDs select observed runs at the requested repository and immutable SHA. A target ref is an assertion against observed target evidence, never a replacement for a missing PR base. Each selected workflow has exactly one selected completed run. Unsupported or conflicting selected evidence fails closed; no newest-run, default-branch, voting, or aggregate-propagation inference is introduced.

Selected workflow text and run/check evidence are collected together. All active required contexts remain in the audit; a requirement belonging to an excluded workflow still fails an unresolved join. Full run enumeration remains required to establish selection and exclusions.

The optional additive `collection.scope` / `provenance.scope` record has exactly `kind`, `repository`, `sha`, `targetRef`, `runIds`, `excludedRunIds`, and `excludedWorkflowPaths`. The core validates coordinates, selected-run equality, unique/disjoint IDs, canonical paths, and disjoint selected/excluded workflows before copying the record. `complete: true` describes this scope, not the entire repository. Report version 1, audit contract v1, status meanings, and exits remain unchanged.

## Alternatives and reversal

Silent newest-run selection, removing active requirements, and substituting a default branch were rejected because they can hide incomplete evidence. Revisit only when an explicit broader observation contract can retain the same coordinate and exclusion guarantees. Legacy calls without selectors retain all-run behavior.
