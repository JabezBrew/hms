# hms-access/src

Status: active
Owner: Security/Backend Engineering
Last reviewed: 2026-06-01
Scope: request context, permissions, patient visibility, reauth, and access decisions.

## Module Map

| File | Owns |
| --- | --- |
| `lib.rs` | public access interface and shared types. |

## Invariants

- Patient access decisions belong here, not in handler-local shortcuts.
- Facility, profile, feature, permission version, patient visibility, offsite,
  and reauth facts should flow through `RequestContext`.
- Access failures must fail closed and remain auditable without exposing PHI.

## Run

```bash
cargo test -p hms-access
```
