# settings feature

Status: active
Owner: Frontend/User Settings
Last reviewed: 2026-10-16
Scope: profile, security, preferences, session, password, MFA, and feature entitlement settings.

## Routes

- `/settings`
- `/settings/profile`
- `/settings/security`
- `/settings/preferences`
- `/settings/feature-entitlements`
- `/settings/network-access`

## Backend Contracts

- `/api/v2/auth/me`
- `/api/v2/auth/password`
- `/api/v2/auth/sessions/*`
- `/api/v2/auth/mfa/*`
- `/api/v2/admin/features/*`
- `/api/v2/auth/network-access`
- `/api/v2/admin/network-policy` and `/preview`

## Invariants

- Security settings must not weaken backend session/auth enforcement.
- Feature entitlement edits are admin-only.
- Session lists and device labels must avoid PHI.
- Appearance supports light, dark, and the device preference, persists locally,
  and responds to device changes while the device option is selected.
- The hub links clinical templates to their existing feature-gated manager;
  it must not advertise unimplemented clinical or notification preferences.
- Rust network policy uses a fresh authoritative current-request decision,
  explicit canonical network review, current-connection lockout protection and
  versioned idempotent publication. Operator bootstrap and trusted proxies stay
  outside the browser. Credential reauthentication does not assert fresh MFA.
