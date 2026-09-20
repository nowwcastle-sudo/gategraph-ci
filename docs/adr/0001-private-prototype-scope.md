# ADR-0001: Read-only experimental scope

- Status: accepted; private-distribution restriction superseded by the owner's experimental OSS publication decision
- Updated: 2026-09-20

## Decision

GateGraph remains a local, read-only diagnostic tool. It may collect public or
least-privilege read-only evidence and emit reports. It must not mutate
workflows, rulesets, branch protection, issues, pull requests, comments or checks.

Experimental source and GitHub release artifacts are public. This distribution
decision does not establish adoption, willingness to pay, production readiness,
or permission to publish to npm. The npm private flag remains enabled.

## Consequences

Keep VERIFIED, INFERENCE and UNKNOWN distinct. Incomplete evidence fails closed;
missing sources never imply a clean result. Hosted services, automatic fixes,
dashboards and organization-wide rollout remain outside scope.

Public availability permits independent inspection and synthetic reproduction.
The tradeoff is a manual local workflow, unsupported evidence cases and no
production support promise.

## Reversal conditions

Expand the operational scope only after demonstrated maintainer value and
sustained use justify a separate design covering authentication, storage,
rollout, recovery and explicit write authority.
