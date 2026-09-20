# Security policy

## Supported scope

Read-only GitHub evidence collection, local workflow analysis, coordinate-bound authored policy, synthetic demos, and installed-package behavior.

The current release is experimental, without a promise of continued backports. Supported runtime:
Node.js 24 on the Windows versions covered by the current candidate CI.
Reports and statuses describe available evidence; they are not a security or
legal certification.

Untrusted workflow parsing and name expansion use the explicit local
[resource ceilings](docs/runtime-resource-limits.md). Exceeding a ceiling
returns a fixed collection error without partial findings. These bounds do not
promise a whole-process memory limit or timeout for external GitHub collection.

## Report a vulnerability privately

Use GitHub's **Security → Report a vulnerability**
control:
https://github.com/nowwcastle-sudo/gategraph-ci/security/advisories/new

If the control is unavailable, do not place sensitive details in a public issue.
An issue asking only to enable private reporting may omit all sensitive details.

Include the release or source commit, runtime version, a minimal synthetic
reproduction, expected behavior, observed fixed error or exit code, and a
redacted impact summary. Do not attach credentials, customer documents, raw
workflow or catalog contents, personal information, or real incident data.

## Handling and disclosure

The repository owner triages reports on a best-effort basis; there is no
guaranteed response-time SLA. Keep reproduction artifacts private. Use a
coordinated disclosure date agreed with the reporter after impact and a fix or
mitigation are understood. Do not publish private report details automatically.

Credential exposure, unintended writes or network access, unsafe output or
archive handling, and privacy-boundary failures are in scope. Unsupported
inputs, unverified official-source content, and claims beyond the documented
evidence model are not proof of a vulnerability by themselves.

A public release requires completed source/security review, reproducible
artifact identity, a working private-reporting channel, and explicit owner
authorization. This policy does not activate GitHub features or publish a
release.
