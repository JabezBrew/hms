# hms-domain

Status: active
Owner: Backend/Product Engineering
Last reviewed: 2026-06-01
Scope: product language, DTOs, policies, capabilities, and projection types.

## Purpose

`hms-domain` gives Rust V2 a shared typed vocabulary. API services and
repositories should exchange domain types instead of ad hoc JSON shapes.

## Domain Files

| File | Product area |
| --- | --- |
| `admin.rs` | organization units, positions, authority, permissions, staff/practitioners |
| `admission_advisories.rs` | nonblocking admission follow-up, captured evidence and original command receipts |
| `auth.rs` | auth/session-facing domain types |
| `billing.rs` | invoices, payments, receipts, NHIS, cash controls |
| `capabilities.rs` | feature keys and capability registry |
| `care.rs` | appointments, visits, triage, encounters |
| `clinical.rs` | notes, templates, problems, allergies, prescriptions, chart entries |
| `consent.rs` | consent grants and revocation |
| `dashboard.rs` | dashboard snapshots, notifications, realtime projections |
| `deployment.rs` | deployment profile and capability shape |
| `inventory.rs` | inventory, stock, procurement, controlled substances, pharmacy |
| `inventory_categories.rs` | lean governed category metadata, explicit parent commands, exact detail and immutable own receipts |
| `laboratory.rs` | catalog, panels, orders, specimens, results |
| `patients.rs` | patient registry, context, Chronicle, break-glass |
| `referrals.rs` | referrals, SLA, waitlist |
| `scheduling.rs` | sessions, templates, availability, booking |
| `search.rs` | omni-search request/response types |
| `ward.rs` | wards, beds, admissions, discharges, nursing |
| `ward_rounds.rs` | ward-round workflow types |

## Invariants

- Domain types should describe product intent, not database implementation.
- List DTOs should stay lightweight.
- Capability keys and deployment profile behavior should fail closed.
- Patient-clinical types should assume Chronicle placement unless an approved
  product decision says otherwise.

## Verification

Run from `backend-rs/`:

```bash
cargo test -p hms-domain
```

## Laboratory availability contract

`laboratory_catalog.rs` owns closed test/panel administration, scalar history and
immutable own command receipts. `laboratory.catalog.manage` has no implicit
patient/demographics or clinical-order permission and does not change privileged
login classification. Public commands change existing availability only; source
identity, definition/price/range/TAT/composition editors are unsupported.
Ward-round catalog targets carry a server-observed optional `catalog_version`;
unknown old targets remain omitted and require explicit re-review for new commits.
