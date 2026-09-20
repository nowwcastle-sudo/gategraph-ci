# Windows portability contract

GateGraph CI targets the Windows x64 runner contract when the
machine has Node.js 24 or newer and npm. Local fixture audits need no GitHub
credentials. Live audits additionally need the GitHub CLI and the operator's
own access; the product still issues only allowlisted GET requests.

The CI verification runs the same checkout on two clean GitHub-hosted Windows
images: `windows-2022` and `windows-latest`. Each image runs locked dependency
installation, all tests, exact package-allowlist verification, and a production
dependency audit. The workflow is [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml).

Only a successful CI run at an identified source revision establishes evidence
for that revision and the stated OS/runtime contract. This document alone
does not claim that an unsupported Node version, an altered npm installation,
or a host with different GitHub permissions can perform a live audit. It also
does not turn a virtual runner result into a guarantee about every physical
device, filesystem, proxy, or enterprise policy.
