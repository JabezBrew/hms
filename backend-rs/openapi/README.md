# backend-rs/openapi

Status: active generated contract
Owner: Backend/Frontend Integration
Last reviewed: 2026-06-01
Scope: Rust V2 OpenAPI artifact.

## Purpose

`hms-v2.openapi.json` is the generated HTTP contract used by the frontend V2
client generator and contract review.

## Generate

Run from `backend-rs/` after API contract changes:

```bash
cargo run -p hms-api --bin hms-openapi -- openapi/hms-v2.openapi.json
```

Then verify the frontend bridge from `frontend/`:

```bash
npm run api:v2:generate:check
```

## Invariants

- Do not hand edit `hms-v2.openapi.json`.
- Contract changes need matching API tests.
- Frontend adapters should consume generated helpers rather than hard-coded
  endpoint shapes.
