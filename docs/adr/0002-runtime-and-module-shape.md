# ADR-0002: Node 24 local CLI with one deep audit module

**Date**: 2026-09-04

**Status**: accepted

**Deciders**: repository owner through the explicit S3 architectural objective

## Context

GateGraph must validate adoption with the smallest read-only prototype. Its differentiator is a join across workflow text, aggregate dependencies, observed check names, and active GitHub control-plane evidence. At the initial design stage no runtime existed. Adoption still does not justify hosted infrastructure.

## Decision

Use Node 24 native ESM JavaScript with JSDoc, built-in `node:test`, and one `yaml` dependency. Expose one deep-module interface, `auditControlPlane(input) -> report`, with a local fixture adapter, read-only `gh` adapter, and thin CLI. Package with `npm pack`; v0.1 has no TypeScript compiler, Octokit, database, server, MCP server, GitHub Action, or auto-fix path.

`yaml` parsing calls `parseDocument`, uses the default YAML 1.2 core schema, checks `doc.errors`, and calls `toJS` only when the document has no parse errors.

## Alternatives Considered

### Hosted GitHub App

- **Pros**: organization installation, automatic webhook-driven audits.
- **Cons**: permissions, webhook security, server, tenant isolation, persistence, retries, monitoring, and incident response.
- **Why not**: adoption and installation willingness are unproven; the operating surface violates the local read-only constraint.

### actionlint plugin/extension

- **Pros**: strong workflow syntax/expression knowledge and familiar lint workflow.
- **Cons**: GateGraph needs live ruleset, check-run, and merge-group evidence outside a static YAML linter's natural scope.
- **Why not**: it couples the experiment to the wrong seam and cannot own the full control-plane join without substantial external machinery.

## Consequences

### Positive

- One small interface hides parsing, graph joining, completeness, classification, and provenance.
- Local fixtures and `gh` are two concrete adapters at a real evidence seam.
- No service lifecycle or stored data; the prototype is easy to test, explain, and remove.
- Node 24 covers testing, JSON, filesystem, CLI, and safe process invocation with one added dependency.

### Negative

- Operators need local Node 24 and `gh` for live audits.
- Invocation is manual; continuous organization monitoring is deferred.
- GateGraph owns normalization of `gh api` responses and version drift.

### Risks

- **False findings**: require explicit voting evidence, active required context, complete sources, and a proven uncovered path.
- **Untrusted workflows**: parse as text only; never execute content or use shell interpolation.
- **Incomplete GitHub visibility**: return `collection-error`, never a clean/safe claim.
- **Architecture inertia**: revisit when validated adopters require hosted events, cannot run Node/`gh`, or prefer a capable actionlint extension.
