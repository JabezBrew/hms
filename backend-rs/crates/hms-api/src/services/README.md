# hms-api/src/services

Status: active
Owner: Backend/Product Workflow Engineering
Last reviewed: 2026-06-01
Scope: API-layer workflow services.

## Service Map

| Path/File | Owns |
| --- | --- |
| `admin.rs` | admin, organization, authority, staff, and audit workflow. |
| `patients.rs`, `ward_rounds.rs` | patient registry, Chronicle, break-glass, and ward-round workflow. |
| `care.rs`, `clinical.rs`, `consent.rs`, `referrals.rs`, `scheduling.rs` | care, clinical, consent, referral, and scheduling workflow. |
| `ward/` | ward, bed, admission, discharge, nursing, MAR, handoff, monitoring, stock workflow. |
| `billing/`, `inventory/`, `laboratory/` | billing, inventory/pharmacy, and lab workflow. |
| `dashboard.rs`, `ops.rs`, `ops/` | dashboard, notification/projection, ops, and metrics workflow. |

## Invariants

- Services are the main API workflow seam.
- Services coordinate access, domain policy, repository calls, and DTO shape.
- New complex workflows should deepen this layer before adding handler logic.
- Keep external I/O out of open DB transactions.
