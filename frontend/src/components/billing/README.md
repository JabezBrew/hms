# frontend/src/components/billing

Status: active
Owner: Frontend Billing Engineering
Last reviewed: 2026-06-01
Scope: invoice, payment, receipt, and insurance slide-over UI.

## Invariants

- Billing views must use least-privilege DTOs and backend-scoped APIs.
- Patient-linked billing data should be displayed only for authorized patient
  context.
- Payment and receipt actions should be auditable and avoid duplicate
  submissions.
