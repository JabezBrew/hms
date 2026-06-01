# frontend/src/assets

Status: active source assets
Owner: Frontend Platform
Last reviewed: 2026-06-01
Scope: source-bundled frontend assets.

## Files

- `react.svg`: default Vite/React asset retained in source.

## Invariants

- Product assets that must be public can live in `frontend/public`.
- Imported/bundled source assets live here.
- Do not store PHI or client-private media in this directory.
