# hms-domain/src

Status: active
Owner: Backend/Product Engineering
Last reviewed: 2026-06-01
Scope: Rust V2 domain types, DTOs, policies, and capability language.

## Module Map

| File | Owns |
| --- | --- |
| `lib.rs` | public domain exports and shared product types. |
| `admin.rs` | organization, authority, staff, audit, and admin DTOs. |
| `auth.rs` | auth/session-facing domain types. |
| `billing.rs` | billing, payments, receipts, cash-control, and NHIS DTOs. |
| `capabilities.rs` | deployment capability identifiers and related domain language. |
| `care.rs` | appointments, clinics, visits, triage, and encounter DTOs. |
| `clinical.rs` | notes, problems, allergies, prescriptions, chart entries, and clinical DTOs. |
| `consent.rs` | consent grant and revocation DTOs. |
| `dashboard.rs` | dashboard, notification, and projection DTOs. |
| `deployment.rs` | deployment profile/domain configuration types. |
| `inventory.rs` | inventory, procurement, pharmacy, stock, and controlled-substance DTOs. |
| `laboratory.rs` | lab catalog, order, specimen, and result DTOs. |
| `patients.rs` | patient registry, Chronicle, and patient context DTOs. |
| `referrals.rs` | referral and waitlist DTOs. |
| `scheduling.rs` | scheduling service/session/template/availability DTOs. |
| `search.rs` | search domain/projection types. |
| `ward.rs` | ward, bed, admission, nursing, MAR, handoff, monitoring, and stock DTOs. |
| `ward_rounds.rs` | ward-round DTOs and workflow types. |

## Invariants

- Domain types should not depend on HTTP extractors or SQLx rows.
- DTOs for hot lists should stay lightweight.
- Capability names must match deployed backend/frontend behavior.
