# frontend/src/components/consent

Status: active
Owner: Frontend Security/Clinical Engineering
Last reviewed: 2026-06-01
Scope: consent and cross-facility share UI.

## Invariants

- Consent UI must make scope, recipient, expiry, revocation, and audit behavior
  explicit.
- Do not expose raw clinical payloads or patient identifiers in browser
  telemetry.
