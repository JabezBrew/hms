# frontend/src/lib/auth

Status: active
Owner: Frontend/Auth Engineering
Last reviewed: 2026-06-01
Scope: React auth provider internals.

## Module Map

| File | Owns |
| --- | --- |
| `AuthContext.js` | auth context definition. |
| `AuthProvider.jsx` | provider component and app-level auth state wiring. |
| `useAuthProviderController.js` | auth provider state machine and side effects. |

## Invariants

- Auth state should come from Rust V2 auth/session APIs where active.
- Do not store secrets or PHI in local storage.
- Session-expiry and forced-password-change states must fail closed.
