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
| `auth.rs` | auth/session-facing domain types |
| `billing.rs` | invoices, payments, receipts, NHIS, cash controls |
| `capabilities.rs` | feature keys and capability registry |
| `care.rs` | appointments, visits, triage, encounters |
| `clinical.rs` | notes, templates, problems, allergies, prescriptions, chart entries |
| `consent.rs` | consent grants and revocation |
| `dashboard.rs` | dashboard snapshots, notifications, realtime projections |
| `deployment.rs` | deployment profile and capability shape |
| `inventory.rs` | inventory, stock, procurement, controlled substances, pharmacy |
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
