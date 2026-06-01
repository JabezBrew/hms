# hms-access

Status: active
Owner: Security/Backend Engineering
Last reviewed: 2026-06-01
Scope: authorization context and access decisions for Rust V2.

## Purpose

`hms-access` owns the request-time facts and decisions that determine whether a
caller can see or mutate HMS data.

## Owns

- `RequestContext`
- facility scope
- active profile scope
- permission and feature facts
- patient visibility
- offsite/reauth facts
- access errors and decision helpers

## Does Not Own

- HTTP response mapping
- SQL persistence
- frontend route guards
- auth token creation

## Invariants

- Patient identifiers require patient-access enforcement before data leaves the
  backend.
- Facility scope must be present for facility-scoped workflows.
- Feature and permission checks fail closed.
- Reauth facts must be fresh for high-risk actions.
- Realtime subscriptions must authorize every channel join and fail closed when
  permission versions become stale.

## Verification

Run from `backend-rs/`:

```bash
cargo test -p hms-access
```
