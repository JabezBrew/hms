# onboarding feature

Status: active support module
Owner: Frontend/Setup Workflow
Last reviewed: 2026-06-01
Scope: onboarding support APIs, hooks, components, events, and setup helpers.

## Routes

No primary app route is exported from this feature today.

## Backend Contracts

Uses setup/deployment APIs only when the deployment enables onboarding behavior.

## Invariants

- Onboarding must not be assumed to exist in every deployment profile.
- First-admin/setup flows are security-sensitive and need explicit backend
  authority.
- Do not store setup secrets or credentials in frontend code.
