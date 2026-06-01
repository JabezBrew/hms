# hms-auth/src

Status: active
Owner: Security/Backend Engineering
Last reviewed: 2026-06-01
Scope: Rust V2 auth/session primitives.

## Module Map

| File | Owns |
| --- | --- |
| `lib.rs` | public auth interface, password hashing/policy primitives, token/session helpers, and auth errors. |

## Invariants

- Tokens, cookies, reset flows, and privileged sessions must fail closed.
- Do not log tokens, password material, reset secrets, or session cookies.
- Password and session behavior should be covered by auth contract tests.

## Run

```bash
cargo test -p hms-auth
```
