# hms-observability

Status: active
Owner: Performance/Operations Engineering
Last reviewed: 2026-06-01
Scope: tracing, logging, route normalization, and metrics helpers.

## Purpose

`hms-observability` centralizes observability behavior shared by API and worker
runtimes.

## Owns

- PHI-safe route-label normalization.
- Tracing/logging subscriber setup.
- Shared observability helpers used by API/worker.

## Invariants

- Metrics labels must use route templates, not raw URLs.
- Do not put patient IDs, MRNs, names, emails, free-text clinical data, request
  bodies, or SQL text in labels/logs.
- New route families should update route normalization so ops dashboards remain
  useful without leaking identifiers.

## Verification

Run from `backend-rs/`:

```bash
cargo test -p hms-observability
cargo test -p hms-api --test telemetry
```
