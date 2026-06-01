# hms-events

Status: active
Owner: Backend Engineering
Last reviewed: 2026-06-01
Scope: event and job payload contracts.

## Purpose

`hms-events` defines payload types shared between request-path code,
repositories, and worker execution.

## Invariants

- Event payloads must be minimal and PHI-safe by default.
- Event names and job payloads should be stable contracts because producers and
  consumers can evolve at different times.
- External side effects should be represented as queued work rather than
  performed inside open request transactions.

## Verification

Run from `backend-rs/`:

```bash
cargo test -p hms-events
```
