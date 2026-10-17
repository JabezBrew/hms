# Generated medication courses and safe schema cutover

Status: frozen local Rust, frontend, native synthetic HTTP, migration, contract
and deployment-script gates pass. Browser,
physical authenticator and live staging acceptance remain separate. Full Python
feature parity is not claimed.

Patient Chronicle now exposes actual generated courses for an explicitly selected
admission. The eight Rust operations provide context, bounded course/dose/supply
history, complete course counts, reviewed next schedule windows, admission-local
stop and immutable original request evidence. Ungenerated prescriptions do not
receive an invented admission or course. The UI identifies generated-only coverage
and keeps historical and current care contexts distinct.

Scheduling a further window creates bounded dose demand and a separate pharmacy
fulfillment. It does not issue physical stock or record administration. Requests
use explicit reviewed stock units; text dosage is never converted into stock
quantities. Original generation replay retains its original supply header after
later expansion. A local stop retires eligible pending doses in that admission;
it preserves the source prescription, other admissions, administered/explicit
outcomes, physical stock and immutable original request membership. Complete
counts refuse corrupt cross-facility children rather than silently omitting them.
Unproved physical balances, mixed units and days of supply remain unavailable.

Clinical writers lock the real source, exact session and current care authority.
Rich bedside medication reads require FullClinical, ordinary patient access and
the selected ward relationship. Central pharmacy retains its separate
prescription-purpose policy. A supplied active-ward permission is rechecked from
actual current permissions rather than inferred from a role. Medication requests
hold the exact server-resolved network-policy version through their business/read
transaction, including first publication from genuinely absent version zero.
This does not claim the same protection for every other clinical family;
cross-workflow policy publication is the next security checkpoint.

The treatment panel uses shadcn primitives and actual generated adapters, with
current capabilities, fresh context on opening, bounded history and explicit
review. The original UUID/body survives ordinary close or an uncertain outcome
in memory. Loss of clinical authority clears clinical copies while preserving
the central opaque manual-review barrier. Rich reads and manual review do not
silently confirm a write. Lazy admission-scope classification preserves the
existing entry budget and checks authority again before dispatch after loading.

## Schema and deployment safety

Migration `202610170023_treatment_course_windows.sql` replaces the old full
course-fulfillment unique constraint with an original-kind partial unique index.
The previous runtime's conflict target is incompatible after that migration.
Deployment therefore drains and verifies stopped API/worker writers before
migration, and records durable intent outside the archive before replacement.

The native migrator's read-only `schema-compatibility` command inspects committed
SQLx metadata under its canonical migration advisory lock with bounded waits. It
emits only a registered decimal epoch. Failed/incoherent history, unknown epochs,
invalid declarations or a missing required migration fail closed. A declared
compatible maximum is not treated as evidence that the minimum required schema
exists. The same rule applies to skip-migration startup.

All supported host deployment entrypoints share a protected external kernel
lease before pulling or replacing source. Nested entrypoints validate the actual
inherited locked file description. An environment value, PID or stale-lock guess
cannot confer ownership. The lease remains held through recovery and by surviving
deployment descendants after supervisor termination. An existing legacy lock is
left intact and requires operator review.

Before any old runtime can restart, recovery stops candidate migration one-offs
and probes the actual committed database again while still holding the host
lease. An incompatible rollback leaves writers stopped and preserves both source
anchors. It does not automatically restore a database or start old code against
the new schema. This single-VM protocol does not govern raw manual Docker/SQL
commands outside the supported deployment entrypoints.

Independent review reproduced three failures before repair: a competing deploy
between rollback probe and restart, misclassified skip-migration startup failure,
and a candidate declaring epoch023 without its migration. All three repaired
counterexamples pass. Real kernel/process tests also cover concurrent entrypoints,
nested ownership, forged descriptors, unsafe files, legacy-lock refusal, supervisor
termination and recovery signal forwarding.

## Local evidence

| Check | Result |
| --- | --- |
| Frozen Rust workspace | 738 unique tests across 121 groups accepted; initial full run had 737 passes and one obsolete telemetry-budget expectation; the corrected complete 11-case suite passes, with no other source or test changes |
| Rust formatting | Pass |
| Frontend | 2,291 tests across 300 files pass; 82 focused checks across eight files pass |
| Frontend lint | Zero errors; 72 existing warnings |
| Production build and generated client | Pass |
| Existing bundle limits | Pass; entry 39.87 KiB gzip, startup 342.08 KiB raw / 70.89 KiB gzip, CSS 31.02 KiB gzip, largest lazy chunk 115.05 KiB gzip |
| Generated OpenAPI | Byte-identical; 482 operations, 390 paths, 1,058 schemas, 3,376 resolved references |
| Fresh isolated migration | 95 successful migrations through epoch023; baseline provisioned once; native compatibility probe confirms epoch023 |
| Native synthetic HTTP | 69 checks pass against the frozen compiled API |
| Native persistence | One course, two supply headers, two command receipts and one local stop; stock conserved, no Given doses, source prescription remains active |
| Warm local debug requests | 600 requests at concurrency five, all HTTP200; course-list p99 24.66 ms and detail p99 29.08 ms |
| Deployment tests | 146 pass; four existing opt-in Docker proxy checks skipped; independent 50-check lease/schema suite and repaired counterexamples pass |
| Native compatibility CLI | Four actual-command tests pass |
| React Doctor | Owned scope 93, zero errors and six complexity warnings; whole scans retain existing unrelated diagnostics |

The frozen API SHA256 is
`60bc4ba2b3f19864e360b8d15a6c5a682d884cd518ea370efc25ddaa15618c24`;
the migrator SHA256 is
`c6ea4a59188f4802ccef944ffeb67d81bbc8da9e707ceeb6fa483d0ce454c332`.
Native acceptance uses an owned synthetic Docker test database, explicit
patient/admission/care-relationship fixtures and actual HTTP prescribing/course
commands. The authenticator signs genuine P256 assertions with a temporary
software key held only in memory. No human account was enrolled or retired and
the primary database was not modified. Warm debug measurements exclude cold
origin, edge, browser and production capacity. Cold staging latency remains open.

The workspace run exposed a test expectation counting only authentication and
connection reads. Four pre-existing clinical proof queries became instrumented
in this checkpoint. The corrected strict budget names those four reads; the complete eleven-case
network-policy suite passes on the final frozen test. This test-only repair does
not add SQL, permit duplicate context resolution or relax production policy.
All other workspace tests passed with zero ignored cases; their source and
production blobs remain identical to that run.

Controlled-stock reconciliation/cryptographic witness proof/UUID receipts, full
pharmacy allocation parity, broader patient-history policy, physical-key and
rendered browser acceptance remain separate. Pushed source is not a live release.
