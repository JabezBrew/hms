# frontend/src/lib/api

Status: active compatibility layer
Owner: Frontend/Backend Integration
Last reviewed: 2026-06-01
Scope: API adapter layer and generated Rust V2 client runtime.

## Purpose

This directory keeps existing frontend API import surfaces stable while routing
Rust V2 mode through generated `/api/v2` helpers.

## Areas

| Path | Purpose |
| --- | --- |
| `v2/generated/client.js` | generated Rust V2 client. Do not hand edit. |
| `v2/client.js` | V2 client wrapper/runtime behavior. |
| `v2/session.js` | session/auth integration helpers. |
| `v2/errors.js` | V2 error mapping. |
| `*.js` | compatibility adapters by product area. |
| `__tests__/v2-*-bridge.test.js` | generated-client/adapter contract coverage. |

## Invariants

- Generated files are produced by `frontend/scripts/generate-v2-api-client.mjs`.
- Feature adapters should preserve UI-facing shapes while using Rust V2 in V2
  mode.
- List/search helpers preserve `AbortSignal` and `AbortError`.
- Do not fetch all pages to filter client-side.
- Dashboard adapters must distinguish absent measurements from measured zero.
  Rust admin snapshots provide active patients, waiting visits, and open invoices;
  unsupported legacy KPIs must not be synthesized from those values. Workforce
  and compliance detail adapters explicitly return `available: false` until a
  supported source exists.
- Inpatient and reception previews preserve section availability and page bounds
  in `meta.sections`. Disabled sections are not requested; a failed optional read
  does not erase successful sections. Aborts still cancel the overall read.
  Ward alert/result/task/medication counters come from the board response; missing
  counters stay `null`. Nursing tasks are not unsigned orders, and page lengths
  are not facility totals or evidence of a personal assignment.
- Keep PHI out of query keys and browser events, while still including
  authorization-sensitive scope.

## Verification

```bash
cd frontend
npm run api:v2:generate:check
npm run test:run -- src/lib/api
```
