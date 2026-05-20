# HMS V2 Rust Testing Architecture

`backend-rs/` is the active HMS V2 backend. Tests should prove Rust-native
interfaces and clinical safety invariants; they should not copy Django test
counts or Django test shapes.

## Test Layers

| Layer | Primary seam | Location | Use for |
| --- | --- | --- | --- |
| Invariant/unit | Pure domain and policy functions | `crates/hms-domain/src/**`, `crates/hms-access/src/**`, small `#[cfg(test)]` modules | State rules, projection rules, guard decisions, cursor helpers, PHI-safe label sanitizers. |
| Policy matrix | `hms-access` guards and decisions | `crates/hms-access/src/lib.rs` tests, later `crates/hms-access/tests/*.rs` when large | Missing facility, wrong facility, disabled feature, missing permission, patient visibility, offsite write blocks, high-risk reauth, and active-authority grants/denials. |
| Repository contract | `hms-db` sqlx repositories against Postgres | `crates/hms-db/tests/<domain>.rs` | Facility-scoped SQL, bounded lists, transaction safety, invalid transitions, append-only ledgers, migration/provisioning idempotency. |
| API workflow contract | Axum handlers/services through `TestApp` | `crates/hms-api/tests/*_contract.rs` and `crates/hms-api/tests/api_contract/<domain>/` | Runtime wiring: extract `RequestContext`, call shared guards, return least-privilege payloads, preserve auth/session behavior. |
| End-to-end journey | A small cross-module clinical path | One or two `journey` modules under `hms-api/tests/api_contract/<domain>/` | Admission-to-discharge, lab order-to-result, invoice-to-receipt, stock movement-to-controlled register. Keep these few. |
| Safety/performance regression | Observability, pagination, payload/query budgets | `hms-observability` unit tests, hot API contract tests, focused DB tests | PHI-safe metrics/log labels, route-pattern metrics, bounded pages, cursor correctness, query-count proof points, payload size budgets. |

## Naming

- Unit/policy tests name the invariant: `offsite_write_requires_onsite_context`.
- DB tests name the repository contract:
  `admission_case_invalid_transitions_fail_without_partial_writes`.
- API tests name the workflow contract:
  `patients_hot_list_clamps_limit_and_preserves_cursor_shape`.
- Journey modules can be broad, but should be rare and named as journeys:
  `ward_admission_and_nursing_workflows_are_patient_access_scoped`.

## Choosing a Seam

- Use `hms-access` when the question is "should this actor be allowed?"
- Use `hms-db` when the question is "does Postgres enforce the repository
  contract under real rows, transactions, and facility scope?"
- Use `hms-api` when the question is "is the handler wired to context,
  guards, DTOs, status codes, and middleware correctly?"
- Use an end-to-end journey only when the risk is in cross-workflow
  composition. Do not turn every happy path into a journey test.

## Test Support

- DB/domain setup belongs in `hms-db::test_support`:
  `TestDatabase`, `TestDb`, `ScenarioBuilder`, and scenario records.
- API-only helpers belong in `crates/hms-api/tests/support/mod.rs`:
  `TestApp`, `Actor`, request helpers, response assertions, cursor assertions,
  and PHI-safe text assertions.
- Keep helpers explicit. A test should still show the patient, facility,
  workflow state, and unsafe transition being proven.
- Do not add production-only bypasses, feature flags, or weakened auth paths for
  tests.

## API Contract Layout

Large API contract suites should be module-ready:

```text
crates/hms-api/tests/ward_contract.rs
crates/hms-api/tests/api_contract/ward/
  mod.rs
  journey.rs
  ward_admin.rs
  bed_management.rs
  admission_cases.rs
  discharge_cases.rs
  nursing_tasks.rs
  mar.rs
  observations_monitoring.rs
  handoff.rs
  ward_stock.rs
```

Prefer grouping related workflow tests into a small number of integration
binaries. Do not create one binary per tiny workflow if that makes Postgres
startup dominate the suite.

## Running Suites

From `backend-rs/`:

```bash
cargo fmt --all --check
cargo test -p hms-access -p hms-observability
cargo test -p hms-db --test ward --test patients
cargo test -p hms-api --test patients_contract --test ward_contract --test telemetry
cargo test --workspace
```

High-risk suites before cutover:

```bash
cargo test -p hms-access
cargo test -p hms-db admission -- --nocapture
cargo test -p hms-db inventory -- --nocapture
cargo test -p hms-db billing -- --nocapture
cargo test -p hms-db laboratory -- --nocapture
cargo test -p hms-api --test auth_contract --test patients_contract --test ward_contract
```

The test database lifecycle uses `HMS_TEST_DATABASE_URL` when supplied. Without
it, tests try a local Postgres database first, then a temporary local Postgres
cluster if the Postgres binaries are available.

## Failure Locality

- Keep one assertion cluster per invariant. If one test proves admission
  activation, do not also prove cash-session closure there.
- If a journey test fails, add or move the sharper assertion down to `hms-db` or
  `hms-access` before expanding the journey.
- Preserve existing assertions when splitting large files. Move first, sharpen
  second.
- Do not hide failures behind broad helper names like `setup_everything`.
  Helpers should build named clinical states: registered patient, ward bed,
  admission case, lab order, stock item, invoice, or cash session.
