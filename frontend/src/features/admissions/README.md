# admissions feature

Status: active
Owner: Frontend/Admissions Workflow
Last reviewed: 2026-06-01
Scope: admission requests, admission cases, and role-specific admission queues.

## Routes

- `/admissions/requests`
- `/admissions/new`
- `/admissions/cases/:caseId`
- `/billing/admissions`
- `/nursing/admissions`
- `/admissions/:admissionId`

## Backend Contracts

- `/api/v2/admissions`
- `/api/v2/admissions/cases`
- `/api/v2/admissions/cases/:id/*`

## Invariants

- Admission-case pages must preserve patient/facility context.
- Billing and nursing queues must use their role-specific data contracts.
- Bed reservation/activation/cancellation state is backend-authoritative.
