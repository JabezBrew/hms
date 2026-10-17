# hms-api/src/services

Status: active
Owner: Backend/Product Workflow Engineering
Last reviewed: 2026-06-01
Scope: API-layer workflow services.

## Service Map

| Path/File | Owns |
| --- | --- |
| `admin.rs` | admin, organization, authority, staff, and audit workflow. |
| `auth_webauthn.rs` | exact-session enrollment/assertion ceremonies with live proof and atomic credential/audit persistence; no MFA-login claim. |
| `auth_factor.rs` | restricted password+factor login/setup, exact-session UV step-up and existing-factor management; durable proof and final deadlines are enforced in auth persistence. |
| `patients.rs`, `ward_rounds.rs` | patient registry, Chronicle, break-glass, and ward-round workflow. |
| `care.rs`, `clinical.rs`, `consent.rs`, `referrals.rs`, `scheduling.rs` | care, clinical, consent, referral, and scheduling workflow. |
| `clinical/prescription_courses.rs` | full-clinical prescribing commands, authorization fences and actor-bound result recovery. |
| `appointment_series.rs` | patient-authorized explicit multi-appointment booking, result recovery and future-member cancellation. |
| `ward/` | ward, bed, admission, discharge, nursing, MAR, handoff, monitoring, stock workflow. |
| `billing/`, `inventory/`, `laboratory/` | billing, inventory/pharmacy, and lab workflow. |
| `dashboard.rs`, `ops.rs`, `ops/` | dashboard, notification/projection, ops, and metrics workflow. |

## Invariants

- Services are the main API workflow seam.
- Services coordinate access, domain policy, repository calls, and DTO shape.
- New complex workflows should deepen this layer before adding handler logic.
- Keep external I/O out of open DB transactions.

Ward Round production services expose selected-admission workspaces, reviewed
aggregate draft saves, atomic commits and original UUID request recovery. Earlier
individual mutation routes authorize then return a typed retirement response.
See the [reviewed command scope](../../../../../docs/v2/2026-10-16-ward-round-command-scope.md)
and `ward_round_commands_contract` for the actual HTTP authorization/lifetime tests.
