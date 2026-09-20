# Local workflow resource limits

GateGraph CI audits untrusted workflow text. The following are **local analyzer limits**, not GitHub Actions limits. They apply to the exported `auditControlPlane` input as well as CLI-collected evidence, including workflows without a matching observed run.

| Resource | Ceiling |
| --- | ---: |
| One workflow, UTF-8 text | 1 MiB |
| All workflow texts in one audit, UTF-8 | 4 MiB |
| Jobs in one workflow | 128 |
| Declared job name, JavaScript string length | 1,024 |
| Values in one supported matrix axis | 128 |
| One matrix value after string conversion, JavaScript string length | 256 |
| One prospective expanded check name, JavaScript string length | 2,048 |
| All expanded check-name string lengths in one audit | 65,536 |

The analyzer checks text size before YAML parsing and computes each matrix name's prospective length before replacing expressions or retaining expanded names. The audit-wide character budget includes ordinary non-matrix job names. If a ceiling is exceeded, the whole audit returns `collection-error` with reason code `WORKFLOW_RESOURCE_LIMIT_EXCEEDED` and a single result; no finding or partial success is emitted. Other unsupported workflow semantics retain their existing fail-closed classification.

These ceilings keep the experimental local analyzer bounded; they are not a claim that larger workflows are invalid on GitHub. If a legitimate repository exceeds a limit, narrow the workflow selection with explicit run selectors where appropriate, or review the limit against a measured local use case before changing it. A selector-free collection can still fetch every workflow blob, so selection is not a substitute for the analyzer bounds.
