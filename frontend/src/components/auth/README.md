# frontend/src/components/auth

Status: active
Owner: Frontend/Auth Engineering
Last reviewed: 2026-06-01
Scope: login, MFA, forced password change, password reset, and route guard UI.

## Invariants

- Do not log credentials, MFA codes, reset tokens, or session identifiers.
- Route guards are UI affordances only; backend access checks remain
  authoritative.
- Session and forced-password-change states should fail closed.
