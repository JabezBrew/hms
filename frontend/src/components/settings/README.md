# frontend/src/components/settings

Status: active
Owner: Frontend Settings/Auth Engineering
Last reviewed: 2026-06-01
Scope: password, MFA, and session management UI.

## Invariants

- Do not log passwords, MFA state secrets, session tokens, or device secrets.
- Security settings should rely on backend session/auth APIs.
