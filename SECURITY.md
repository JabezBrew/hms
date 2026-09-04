# Security Policy

HMS is clinical infrastructure. Thank you for reporting responsibly.

## Supported versions

| Version / branch | Supported |
| --- | --- |
| `main` (latest) | Yes |
| Tagged releases (`v*`) | Security fixes for the latest release only |
| Older commits / forks | Best effort — please upgrade and retest |

## Reporting a vulnerability

**Do not open a public GitHub issue for suspected vulnerabilities.**

Email the maintainers privately with:

- Affected component and version/commit
- Impact and attack scenario
- Steps to reproduce (synthetic data only — no PHI, no production data)
- Any logs or proof of concept (redacted — no credentials, tokens, MRNs,
  names, or patient identifiers)

We aim to acknowledge within **3 business days** and to share a remediation
plan or timeline within **14 days**. We will credit reporters on request
once a fix is released.

## Scope

In scope:

- Authentication / session / password-reset / reauth bypasses
- Authorization failures (facility scoping, patient-access guards,
  permission checks, realtime channel authorization)
- PHI exposure via logs, metrics, errors, exports, URLs, cache keys, or APIs
- Injection (SQL, command, template), SSRF, open redirects on auth flows
- Secrets committed to the repo or leaked through build artifacts

Out of scope (please still tell us if you see real impact):

- Social engineering, physical attacks
- DoS volume testing against shared staging hosts
- Reports based solely on scanner output without a working proof of concept
- Issues in the legacy Django backend that do not affect the Rust V2 path
  (mention them anyway so we can label correctly)

## Handling PHI

Never include real patient data in a report. Use the demo seed
(`docs/v2/rust-v2-demo-seed.md`) to build synthetic reproductions.

## Safe harbor

We will not pursue legal action against researchers who follow this policy,
avoid degrading service, avoid accessing other users' data, and delete any
incidentally accessed data immediately after reporting.
