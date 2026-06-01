# hms-auth

Status: active
Owner: Security/Backend Engineering
Last reviewed: 2026-06-01
Scope: auth/session/password/passkey primitives used by Rust V2.

## Purpose

`hms-auth` provides the primitives used by `hms-api` for authentication and
session safety.

## Owns

- JWT-related auth claims and validation primitives
- refresh-session primitives
- password reset support
- password hashing helpers
- MFA/passkey/recovery-code primitives

## Does Not Own

- facility or patient authorization
- HTTP cookie response mapping
- staff/profile persistence
- frontend session UI

## Invariants

- Auth primitives should be reusable without learning HTTP handler details.
- Privileged/high-risk action support must fail closed when required auth facts
  are missing.
- Session data must not expose PHI in logs or metrics.

## Verification

Run full backend auth/API coverage from `backend-rs/`:

```bash
cargo test -p hms-auth
cargo test -p hms-api --test auth_contract
```
