# frontend/src/hooks/nursing

Status: active compatibility area
Owner: Frontend Nursing Engineering
Last reviewed: 2026-06-01
Scope: nursing hooks not yet fully moved into `features/nursing`.

## Module Map

| File | Owns |
| --- | --- |
| `nursingQueryKeys.js` | nursing query-key helpers. |
| `useFluidBalanceQueries.js` | fluid-balance query helpers. |
| `useShiftHandoffQueries.js` | shift handoff query helpers. |
| `useTreatmentSupplyQueries.js` | treatment supply query helpers. |

## Invariants

- Nursing clinical data belongs in authorized Patient Chronicle/ward context.
- Preserve cancellation and scoped query keys.
- Do not put clinical text, patient names, or MRNs in query keys.
