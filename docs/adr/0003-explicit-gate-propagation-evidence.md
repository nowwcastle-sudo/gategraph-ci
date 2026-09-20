# ADR-0003: Require explicit gate-propagation evidence

- Status: accepted
- Date: 2026-09-05
- Supersedes: the earlier native-`needs` propagation assumption

## Context

A required GitHub Actions job that depends on a failed job may be skipped. GitHub treats a skipped required job as a successful required-check outcome for merge purposes. Dependency ancestry therefore proves scheduling order, not that an upstream failure will make the required context block a merge.

GateGraph previously treated every ancestor of a native required aggregate as covered. That could suppress the exact uncovered voting failure path the prototype is intended to report.

## Decision

- A directly required producer job needs no aggregate-propagation policy; its required check is direct evidence.
- A required job with one or more `needs` dependencies contributes transitive coverage only when its exact `<workflow-path>/<job-id>` has an exact policy record with `failurePropagation: all-needs` and an evidence identifier.
- This rule applies whether the aggregate has no `if` expression or the supported `if: always()` expression. Dependency ancestry alone never supplies the missing proof.
- Missing, malformed, extra-field, wrong-gate, or wrong-propagation records fail closed as `collection-error`.
- Reports never copy the raw policy evidence identifier. They emit only its lowercase 12-hex SHA-256 fingerprint so independently retained evidence can be matched without reflecting token-shaped input.
- Canonical input must also carry the exact allowlisted analyzer identity, package version, contract revision, and canonical UTC `analyzedAt`; adapters own that observation metadata and the pure core only validates and copies it.

## Consequences

The model makes fewer coverage claims and cannot turn incomplete propagation evidence into a finding or a clean result. Existing immutable fixtures must explicitly record aggregate propagation evidence.

The current live `gh` adapter intentionally does not author or infer policy. Therefore a live audit whose required context is an aggregate job returns `collection-error` until an independently reviewed exact gate-policy record is supplied through a future input workflow. Direct required producer contexts remain analyzable. ADR-0005 adds that reviewed input surface; without explicit policy this limitation still applies.

YAML document conversion is also an evidence boundary: `doc.toJS()` failures, including alias-expansion limits, return the generic `WORKFLOW_PARSE_ERROR` report without exception text or workflow content.

## Reversal condition

Revisit this decision only when a first-party immutable GitHub signal directly proves merge-blocking failure propagation for the exact required aggregate, or when a reviewed live policy-input surface can bind equivalent evidence to the same repository, SHA, workflow path, job, and observation time. Do not restore ancestry inference from workflow syntax alone.
