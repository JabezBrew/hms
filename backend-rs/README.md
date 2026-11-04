# HMS Rust V2 Backend

Status: active
Owner: Backend Engineering
Last reviewed: 2026-11-04
Scope: active Rust backend workspace under `backend-rs/`.

## Purpose

`backend-rs/` is the active HMS backend. It owns `/api/v2`, Rust V2 OpenAPI,
PostgreSQL persistence, Redis-backed runtime concerns, background jobs,
authorization, migrations, and provisioning.

The legacy Django backend under `../backend/` is reference only unless a task is
explicitly legacy Django work.

## Workspace Crates

| Crate | Role |
| --- | --- |
| `crates/hms-api` | Axum API server, route mounting, HTTP handlers, service interfaces, middleware, OpenAPI. |
| `crates/hms-access` | Request context, feature/permission checks, patient/facility visibility, reauth facts. |
| `crates/hms-auth` | JWT/session/password reset/passkey primitives. |
| `crates/hms-domain` | Domain records, DTOs, capability/deployment types, product vocabulary. |
| `crates/hms-db` | SQLx repositories, transaction helpers, migrations/provisioning support. |
| `crates/hms-events` | Event and job payload contracts. |
| `crates/hms-worker` | Background job runner for work that must not block request paths. |
| `crates/hms-migrator` | Migrations, baseline provisioning, demo/performance seeding. |
| `crates/hms-observability` | PHI-safe route normalization, tracing/logging/metrics setup. |

## Request Flow

```text
routes/* -> handlers/* -> services/* -> hms-access
                                      -> hms-domain
                                      -> hms-db
                                      -> hms-events / hms-worker
```

- `routes/*` mounts URLs only.
- `handlers/*` extracts HTTP inputs and maps OpenAPI responses.
- `services/*` owns workflow orchestration and should be the first place to put
  new complex backend behavior.
- `hms-access` owns access decisions; do not recreate patient/facility checks in
  handlers.
- `hms-db` owns SQL and repository interfaces; handlers should not run SQL.

## Runtime Entrypoints

| Entrypoint | File | Use |
| --- | --- | --- |
| `hms-api` | `crates/hms-api/src/main.rs` | HTTP API runtime. |
| `hms-openapi` | `crates/hms-api/src/bin/openapi.rs` | Regenerates `openapi/hms-v2.openapi.json`. |
| `hms-worker` | `crates/hms-worker/src/main.rs` | Background worker runtime. |
| `hms-migrator` | `crates/hms-migrator/src/main.rs` | Migrations and provisioning. |

## Authentication rollout

Password sign-in can return a restricted `setup_required` or `factor_required`
grant rather than a normal token. An enrolled account must verify its existing
factor; an unenrolled privileged account needs named-user operator setup and a
separate signed passkey assertion. Voluntary first-key setup for other accounts
uses the explicit setup-start operation. Password-only compatibility remains
limited to unenrolled accounts outside the privileged-login policy.

Run `hms-migrator auth-readiness --facility-code ...` in the private migration
environment before rollout. Arrange a real identity check and secure one-time
token delivery for each named user who needs `bootstrap-factor`; do not enroll
an ephemeral test signer onto a human account. Readiness counts cannot prove
physical authenticator usability. Use the exact configured browser origin/RP
pair; staging requires the reviewed HTTPS origin. Migration022 creates no factor
assurance for existing sessions. See
[`authentication policy`](../docs/v2/2026-10-17-authentication-policy.md),
[`session assurance scope`](../docs/v2/2026-10-17-session-factor-assurance-scope.md)
and the [migrator commands](crates/hms-migrator/README.md).

## Schema And Generated Contracts

- SQL migrations live in `migrations/`.
- Rust OpenAPI output lives in `openapi/hms-v2.openapi.json`.
- Frontend generated-client tooling lives in
  `../frontend/scripts/generate-v2-api-client.mjs`.

Regenerate OpenAPI from `backend-rs/` after HTTP contract changes:

```bash
cargo run -p hms-api --bin hms-openapi -- openapi/hms-v2.openapi.json
```

## Governed supplier administration

Supplier administration adds exact contact/address maintenance, bounded directory/
history, unused lifecycle and original-actor receipt recovery, preserving the old
eight-field list. Runtime032 requires the supplier migration before provisioning;
matching API/worker/migrator and the deployment quiesce fence are required.
Supplier-row defaults now preserve current configuration independently of the
existing optional NULL-only item binding. PO names, preferred/alternative supplier
relationships, assignment UI and procurement identity are separate work. See the
[supplier repository contract](crates/hms-db/src/inventory/suppliers/README.md).

## Safety Rules

- Patient identifiers require access checks before returning or mutating data.
- List endpoints must be bounded and cursor-paginated.
- Hot list DTOs must be lightweight projections.
- Cache/realtime keys must include facility/user/profile/visibility-changing
  scope.
- Do not log PHI, request bodies, raw URLs with patient IDs, MRNs, or free-text
  clinical data.
- Do not block request paths or dashboards on FHIR/external I/O.
- Do not hold DB transactions while waiting on external I/O.

## Validation

```bash
cd backend-rs
cargo fmt --all --check
cargo test --workspace
```

Start the root Docker Compose dependencies first with
`docker compose up -d postgres redis`. Rust DB-backed tests use that Docker
Postgres service and create isolated `hms_v2_test_*` databases via
`createdb`/`dropdb`; make those client tools available on `PATH` and keep
client-tool passwords in a private shell environment. Dependency or credential
failures stop the tests; the helper never starts a machine-local Postgres cluster.
Do not commit or print DB passwords.

Focused suites:

```bash
cargo test -p hms-access
cargo test -p hms-db admission -- --nocapture
cargo test -p hms-db inventory -- --nocapture
cargo test -p hms-db billing -- --nocapture
cargo test -p hms-db laboratory -- --nocapture
cargo test -p hms-api --test auth_contract --test patients_contract --test ward_contract
```

## Laboratory catalog availability

Checkpoint 27 implements availability governance for existing facility test and
panel definitions at epoch 033. Nine new compiled/generated catalog operations
bring the actual API/SDK to 549 operations. The metadata-management purpose stays
separate from patient ordering and verification. Existing orders and original
Ward Round receipts retain their supported completion/recovery paths.

Complete local component checks pass: 1,245 Rust tests, 4,010 frontend tests and
618 ops tests plus 25 separately executed storage-guard tests, with no failed or
skipped coverage. The latter two suites total 643 nonoverlapping cases. Final
native attempt 17, protected timing and 326 catalog/80 Ward browser checks pass.
Selected visuals were inspected; exact three-database cleanup conserves all 63
unrelated entries. These documentation supplements are separately bound to the
executed source maps; they do not establish Linux, hardware or deployment proof.

Migration 033 requires matching API/worker/migrator binaries and the deployment
quiesce/no-old-restart fence. API and worker check live layout before provisioning
or serving. A live-layout check before all normal migrator provisioning/seeding/
search work is a checkpoint 28 proposal, not a 033 guarantee. Historical ordered
facts are not snapshotted in 033; creation, definition editing/reset, composition,
price, ranges and TAT remain queued public features. Source-confirmed
self-verification, aggregate completion and malformed result/order ownership gaps
have checkpoint 28 source proposals only; no compiled/runtime fix is claimed here.

See the [catalog scope](../docs/v2/2026-11-04-laboratory-catalog-governance-scope.md)
and [checkpoint 27 verification](../docs/v2/2026-11-04-checkpoint-27-verification.md)
for the finite contract, executed checks and remaining acceptance gates.
Local Cargo compilation follows the [shared-target storage policy](../ops/CARGO_BUDGET.md).
The guard has canonical lightweight test evidence; actual Cargo admission and the
versioned original-six runner integration remain pending.
