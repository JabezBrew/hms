# problems feature

Status: active support module
Owner: Frontend/Clinical Documentation
Last reviewed: 2026-06-01
Scope: problem-list support APIs, hooks, and components.

## Routes

No standalone route is exported from this feature today. Patient problem data
belongs in Chronicle/clinical context.

## Backend Contracts

- `/api/v2/patients/:patient_id/clinical/problems`
- `/api/v2/clinical/problems/:id`
- `/api/v2/clinical/problem-links`

## Invariants

- Patient problem data is clinical data and must remain patient-access scoped.
- Problem links should preserve same-patient constraints and audit behavior.

## Asynchronous clinical notifications

Problem resolution captures a scoped notification publisher before the mutation.
Its success and error messages are suppressed if the originating component,
authorization, patient context, transport or current network proof changes before
completion. Normal same-scope messages remain visible. This affects publication
only: it does not retry, abort or acknowledge a write, and it leaves the shared
unknown-write barrier intact. Other asynchronous callers should adopt the shared
hook when separately reviewed; this is not a claim that every HMS toast is scoped.
