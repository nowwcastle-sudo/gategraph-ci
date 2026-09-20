# ADR-0005: Accept explicit coordinate-bound authored policy

- Status: accepted
- Date: 2026-09-05
- Authority: owner-approved authored-policy input design
- Supplements ADR-0003; its historical limitation remains recorded

## Decision and trust meaning

An operator may explicitly supply the reviewed `gategraph-authored-policy/v1` JSON envelope through `--policy-file`, with explicit run IDs and target ref. This is an operator-authored assertion, not authenticated maintainer approval or independent evidence retrieval. The operator retains the evidence and must never infer all-needs propagation from dependency ancestry alone.

The envelope binds repository, SHA, target, selected run/workflow/attempt set, and canonical review time. Review time is after the Unix epoch and no later than the audit's analysis time; no arbitrary TTL is introduced. The current audit freshly collects active control-plane evidence and does not claim the current ruleset existed at the historical review time.

The reader uses a fixed 64 KiB plus one detection-byte buffer, closes the file in finally, and returns a safe invalid-input result for unreadable, oversized, malformed, or excessive-depth input. JSON syntax is required. Existing yaml@2.9.0 duplicate-key detection checks decoded keys at every depth after JSON.parse checks JSON syntax. Exact schema/type validation rejects extra keys, prototype-related keys, duplicates, and coordinate mismatches before policy is applied. No dependency, policy discovery, network policy lookup, or policy execution is added.

For policy-bound collection only, the collector requires a positive observed `run_attempt` and reads jobs from the exact [attempt-specific GET endpoint](https://docs.github.com/en/rest/actions/workflow-jobs#list-jobs-for-a-workflow-run-attempt). It does not invent a job-level run_attempt field or default missing attempt evidence to 1. CLI invocation enables this internal collector requirement after pre-network policy validation; the authored attempt must subsequently equal the observed attempt.

Policy application clones canonical input, preserves prior failures and complete=false, and replaces only complete policy/not-supplied markers. Existing core validation still rejects unsupported jobs, gates, propagation, and missing aggregate evidence. Gate-only policy does not establish voting intent.

The optional additive collection.policyInput/provenance.policyInput record contains only contract, exact coordinate, reviewedAt, and 12-hex SHA-256 evidence/document fingerprints. The core validates this record before copying it. Raw evidence strings, local file/account paths, parser errors, and extra fields are never copied. Report version 1, audit contract v1, and status/exit semantics remain unchanged.

## Alternatives and reversal

Automatic voting/propagation inference and remote policy discovery were rejected because they bypass the explicit evidence boundary. Revisit this decision only for first-party immutable propagation evidence or a separately approved requirement for authenticated policy authorship.
