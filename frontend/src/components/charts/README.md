# frontend/src/components/charts

Status: active
Owner: Frontend Clinical UI Engineering
Last reviewed: 2026-06-01
Scope: chart templates, chart entry forms, review UI, and trend graphs.

## Invariants

- Clinical chart data belongs in Patient Chronicle or panels launched from it.
- Heavy trend graphs should be lazy/deferred.
- Do not log chart values or free-text clinical fields.
