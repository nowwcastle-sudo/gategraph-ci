# GateGraph domain context

## Purpose

GateGraph models the path by which a GitHub Actions result becomes—or fails to become—a merge requirement. Its domain is control-plane coverage, not workflow syntax or security scanning.

## Core model

```text
event + path condition
  -> workflow / reusable workflow
  -> matrix-expanded check run
  -> job dependency / aggregate
  -> required context in active gate
  -> merge decision coverage
```

## Glossary

- **producer job**: a workflow job whose result may be relevant to merge safety.
- **matrix cell**: one expanded execution of a matrix job, usually exposed as its own check name.
- **aggregate**: a job that combines dependency conclusions into one stable check, such as alls-green or a DIY shell gate.
- **active gate**: the GitHub ruleset or classic branch-protection requirement currently governing the target ref.
- **required context**: the exact status-check name required by the active gate.
- **observed check-run**: a check-run actually emitted for an identified PR or merge-group SHA.
- **coverage edge**: a proven connection from a producer result through any aggregate to a required context.
- **uncovered failure path**: a case where a producer can fail while every context required by the active gate can still succeed.
- **voting job**: a job confirmed by policy or failure-path evidence to affect whether a change should merge.
- **advisory job**: a job intentionally allowed not to block merge.
- **policy review**: a classification used when graph shape is suspicious but voting intent or an active uncovered path is not proven.
- **evidence incomplete**: one or more required sources could not be collected or resolved; it is not a clean result.
- **experimental diagnostic**: the read-only local tool used to inspect bounded evidence; public availability does not establish adoption or enforcement.

## Evidence language

- `VERIFIED`: directly observed in immutable workflow content, active public configuration, or identified run/job data.
- `INFERENCE`: derived from verified graph edges and documented GitHub behavior.
- `UNKNOWN`: not established, especially maintainer intent, adoption, or hidden/private configuration.

Do not use "safe", "covered", or "no protection" when evidence is incomplete. Prefer `no-proven-gap` for a bounded analysis that found no demonstrated uncovered path.

## Invariants

- Read-only analysis never changes the system it audits.
- A non-required job is not automatically a defect.
- A workflow conclusion is not interchangeable with a required context conclusion.
- A classic protection endpoint 404 does not prove absence of protection.
- Every material result retains its repository, SHA, run/configuration coordinate, collection time, and source outcome.

## Current boundary

GateGraph is an experimental public CLI at https://github.com/nowwcastle-sudo/gategraph-ci, with clean public history. Version 0.2.0-experimental.1 includes an installed synthetic demo, explicit observed-run scope, causal diagnostics, coordinate-bound operator-authored policy and bounded workflow processing.

Authored policy is not authenticated maintainer approval. Aggregate propagation and voting intent are never inferred from dependency ancestry. UNKNOWN is not approval. Public source and GitHub release assets do not imply npm publication, production certification or demonstrated adoption.

The release guide documents packaging and local installation. CI results and checksums bind to one identified source revision. GitHub App installation, automatic fixes, dashboards, billing and other write surfaces require separate design decisions.
