# settings feature

Status: active
Owner: Frontend/User Settings
Last reviewed: 2026-06-01
Scope: profile, security, preferences, session, password, MFA, and feature entitlement settings.

## Routes

- `/settings`
- `/settings/profile`
- `/settings/security`
- `/settings/preferences`
- `/settings/feature-entitlements`

## Backend Contracts

- `/api/v2/auth/me`
- `/api/v2/auth/password`
- `/api/v2/auth/sessions/*`
- `/api/v2/auth/mfa/*`
- `/api/v2/admin/features/*`

## Invariants

- Security settings must not weaken backend session/auth enforcement.
- Feature entitlement edits are admin-only.
- Session lists and device labels must avoid PHI.
