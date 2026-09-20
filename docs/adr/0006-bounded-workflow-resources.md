# ADR-0006: Bound workflow processing before name expansion

- Date: 2026-09-20
- Status: accepted implementation under the owner's public-readiness request
- Extends ADR-0002 without changing the local CLI/library architecture

## Problem

The original source could expand repeated matrix expressions into very large
retained strings before validating observed-run joins. Per-response transport
limits and YAML alias handling did not bound ordinary string substitution.
An unexecuted extra workflow was reachable in selector-free audits.

## Decision

Use fixed local resource ceilings in the existing audit module; do not add a
dependency, worker service or operator configuration solely for this fix.
Check individual and aggregate UTF-8 workflow bytes before parsing. Bound job
count, declared names and matrix values. Calculate every prospective expanded
name and the audit-wide total before replacement. Ordinary names consume the
same aggregate budget.

Exceeding a limit returns one collection-error with the fixed code
WORKFLOW_RESOURCE_LIMIT_EXCEEDED, no finding and no partial success. Other
unsupported semantics retain their conservative handling. Exact ceilings and
units are in [runtime-resource-limits](../runtime-resource-limits.md).

## Tradeoff and reversal

Valid GitHub workflows can exceed these deliberately narrower local limits.
They are not GitHub validity rules. Explicit observed-run selection may reduce
the relevant input set, but cannot replace analyzer limits or weaken active
required-context joins. Reconsider a limit only from a measured supported use
case with prospective-allocation protection preserved.

These controls bound the stated workflow/name resources, not every process
allocation, network request, external gh execution time or host resource.
Unknown remains non-approval. No workflow commands execute and collection
remains GET-only.

## Verification boundary

Small focused regressions cover long names/values, matrix cardinality, job
count, prospective expansion in an unexecuted workflow, aggregate multi-workflow
allocation and ordinary numeric/boolean matrix order. CI and independent review apply to the exact source revision they inspect.
