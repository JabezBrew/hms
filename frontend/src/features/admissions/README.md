# admissions feature

Status: active
Owner: Frontend/Admissions Workflow
Last reviewed: 2026-06-04
Scope: admission requests, admission cases, and admission detail workflow links.

## Routes

- `/admissions/requests`
- `/admissions/new`
- `/admissions/cases/:caseId`
- `/billing/admissions`
- `/admissions/:admissionId`

## Backend Contracts

- `/api/v2/admissions`
- `/api/v2/admissions/cases`
- `/api/v2/admissions/cases/:id/*`

## Invariants

- Admission-case pages must preserve patient/facility context.
- Billing queues must use their role-specific data contracts.
- Nursing admission work should stay in admissions, Ward Board, or Chronicle
  context rather than a standalone nursing page.
- Bed reservation/activation/cancellation state is backend-authoritative.

## Rust admission follow-up

`advisory/` owns the nonblocking Admission follow-up checklist in Patient Chronicle. The operational case header hands off an exact case; it does not expose clinical notes or infer full access. System activation/intake blockers and the legacy task adapter remain separate. See [advisory/README.md](advisory/README.md) for current contracts and safety rules.
