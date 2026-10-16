# docs/v2

Status: active for Rust V2 planning and cutover decisions
Owner: Backend/Operations Engineering
Last reviewed: 2026-06-01
Scope: Rust V2 backend architecture, seed behavior, cutover scope, and production readiness.

## File Map

| File | Owns |
| --- | --- |
| `rust-v2-backend-spec.md` | Rust V2 backend architecture, request model, access model, performance model, and milestones. |
| `v2-cutover-scope.md` | what is in/out of first Rust V2 cutover. |
| `v2-production-cutover.md` | production readiness gates and environment-independent proof sequence. |
| `rust-v2-demo-seed.md` | demo seed behavior and provisioning expectations. |
| `2026-10-15-phase-one-verification.md` | scoped security, worker reliability, clinical UI changes, acceptance evidence, and remaining gaps. |
| `2026-10-15-parity-ledger.md` | expanded Python-to-Rust and UI parity phases, concrete gaps, acceptance rules, and implementation state. |
| `2026-10-15-phase-two-verification.md` | first parity increment and exact staged-source local acceptance. |
| `2026-10-15-phase-two-b-verification.md` | scoped fluid/emergency access, NHIS UI, reset lifecycle and exact-source acceptance. |
| `2026-10-16-phase-eight-verification.md` | explicit scheduled stock units, inpatient narrative handover, clinical visibility and scoped notifications; frozen acceptance evidence. |
| `2026-10-16-phase-ten-verification.md` | atomic ward-round draft/commit and clinical artifact evidence, fluid live authority and selected-admission workspace; exact-source acceptance. |
| `2026-10-16-phase-nine-verification.md` | immutable note/template evidence, protected nursing records, selected-admission vital entry and confirmed decisions. |
| `2026-10-16-nursing-record-workspace.md` | scoped task/vital windows, ward-board decisions, uncertainty and clinical context lifetime. |
| `2026-10-16-scheduled-stock-basis-scope.md` | reviewed stock units, physical supply evidence, care-context and authority lifetime contracts. |
| `2026-10-16-patient-handover-scope.md` | inpatient handover, protected immutable revisions, ward scope and exact command recovery. |
| `2026-10-16-clinical-data-visibility-scope.md` | clinical data classes, purpose projections and authoritative UI action flags. |
| `2026-10-16-scoped-clinical-notifications.md` | obsolete-workspace notification suppression and regression evidence. |
| `2026-10-16-phase-seven-verification.md` | prescription documentation/new courses, PRN continuity, scoped nursing and exact-source acceptance. |
| `2026-10-16-prescribing-course-scope.md` | explicit prescription documentation and renewal/replacement contracts, provenance and safety boundaries. |
| `2026-10-16-scoped-nursing-lists.md` | bounded treatment/alert/shift lists, critical preview and guarded immutable acknowledgments/finalization. |
| `2026-10-16-dependency-audit.md` | current npm/OSV advisory scan and active Linux dependency-tree evidence. |
| `2026-10-16-phase-six-verification.md` | trusted-network policy, interrupted-write recovery, proxy privacy and exact-source acceptance. |
| `2026-10-16-trusted-network-policy-scope.md` | trusted socket/proxy provenance, fail-closed facility policy, reviewed writes, and explicit operator bootstrap. |
| `archive/` | historical V2 material kept out of the active path. |

## Invariants

- `backend-rs/` and generated `/api/v2` contracts are the active backend path.
- Current synthetic solo testing uses `ops/free-testing/README.md`; GCP
  staging/performance runbooks remain available for that deployment shape.
- Single-VM Compose remains rollback/reusable reference.
- Django behavior is reference only unless a task explicitly asks for legacy
  maintenance or parity research.
