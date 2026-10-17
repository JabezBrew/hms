# Runtime schema compatibility and migration quiescence

Status: focused local verification passed. No deployment or production recovery
is claimed by these source changes; checkpoint release acceptance is separate.

## Breaking medication boundary

Migration `202610170023` replaces the full fulfillment uniqueness constraint
with a partial original-header index, allowing additional scheduled-window
headers. Checkpoint 12 generation and PRN SQL use a bare conflict target requiring
the old full constraint. They cannot safely remain running during this migration
or be automatically restarted against the upgraded schema. Keeping that old
constraint would prevent the new multiple-window workflow.

The committed `ops/compose-v2/runtime-schema-epoch` explicitly declares the
runtime's maximum reviewed breaking-schema epoch. An older artifact without the
declaration supports epoch zero. A migration filename is never evidence that an
artifact's code is compatible. The shell guard checks the explicit declaration
against both the actual database and the candidate's known breaking migration.
The current runtime requires026: a declaration of026 with its required
migration omitted is an invalid artifact, not an epoch-zero candidate. A fresh
post-migration probe must report the required epoch before any API or worker is
started. `--skip-migrations` cannot bypass either the minimum or maximum check.

## Breaking referral-response boundary

Migration202610170024 adds governed response revisions, immutable command
receipts, scoped completeness/root consistency and legacy-import observation.
Earlier023 code exposes response content and permits writes outside this purpose.
It must remain stopped after024 commits. The probe validates embedded023/024
checksums, success and required columns/enabled guards, rather than trusting a
table name or a declaration alone. API and worker run an eight-second bounded
gate once before provisioning/listen or worker metrics readiness; this is separate
from cheap health probes. The new epoch024 runtime refuses an epoch023 schema before startup and accepts
the required epoch024 schema. Older binaries are not assumed to recognize
migrations introduced after their build.

## Breaking placement and task-routing boundary

Migration202610170025 adds immutable placement intervals, move revisions/receipts
and effective nursing-task routing. Earlier024 code neither maintains those
intervals nor respects the effective service ward. It must remain stopped after
025 commits. The current runtime requires025 before provisioning or readiness.
The same bounded read-only migration-lock probe validates coherent embedded
023/024/025 checksums, committed success, required layout, enabled deferred
consistency guards and the reviewed index keys. It does not certify arbitrary
SQL function bodies or every possible operator alteration.

The recovered local ops suite passes156 cases with four existing opt-in skips.
Two subprocess fixture deadlines expired during concurrent local compilation.
The test harness now allows30 seconds for process startup overhead while its
fake-clock assertions retain the actual deployment deadline checks. The complete
rerun passes with unchanged production shell sources. Actual025 schema gates pass16 cases: database6, migrator6, API2
and worker2. Essential lost/renamed column controls and an actual copied CLI
refuse incomplete layouts; the new epoch025 runtime refuses an epoch024 schema
before provisioning/readiness.
These focused results supersede older023/024 counts below. Native release and
live deployment acceptance remain separate; declarations do not establish them.

## Single-host deployment lease

Every supported host deployment entrypoint uses the same kernel `flock` lease at
`/opt/.hms-deploy-state/deploy.lock`. Frontdoor in-place, direct GCP/Compose,
free-testing, legacy forwarding and archive installation all acquire it before
their first runtime/source mutation and retain it through recovery and restart.
Remote archive packaging remains independent; the committed Python helper is
uploaded beside the standalone installer. Manually copied installers need that
matching helper too. A missing helper fails closed.

The lease path cannot be changed by an environment variable. The directory and
regular lock file must be private and owned by the deploying identity; symlinks,
unsafe modes, unexpected owners and changed inodes are rejected. Different users
cannot silently choose different locks for the same host. Initial creation may
use bounded noninteractive sudo only when the canonical directory is absent.
Existing ownership is never stolen or automatically reassigned.

Nested entrypoints inherit and verify the actual locked file description. A
plain environment marker or unrelated inherited descriptor cannot bypass the
kernel lock. The supervisor and active child retain the descriptor, including
when the supervisor is killed. There is no PID-based unlock or lock-file deletion.
An existing legacy `/tmp/hms-deploy.lock` requires explicit operator review; the
new remote runner does not create or automatically remove that legacy state.

This serializes the rollback probe, tree swap and runtime restart against other
supported deploys, closing the probe-to-restart race. It is a single-VM protocol,
not protection against an operator independently running raw Docker, SQL or
obsolete deployment scripts outside the reviewed entrypoints.

## Deployment order

The reusable single-VM Compose deployment performs backup gates, image build and
database connectivity checks before quiescing application services. It requires
Python 3 for atomic state-file replacement with file and directory fsync. The
default migration path records durable quiesce intent, stops API and worker with
a bounded graceful timeout, verifies neither remains running, records the
schema-attempt fence, and only then runs migrations. A failed drain never starts
migration. Services start only after migration and baseline provisioning succeed.
This is a maintenance window, not a zero-downtime migration claim.
The attempt stage also changes before a skipped-migration runtime replacement,
so a failed `up` can never claim that existing containers were left untouched.

The archive installer puts each attempt's stage file and the persistent
compatibility fence outside the swapped source trees. A pre-quiesce failure
restores source only, leaving the existing running application containers
untouched. Missing or malformed stage state never implies a pre-quiesce failure.
Local state files contain only protocol stages/epoch numbers, use mode 0600, and
must be retained during recovery. Standalone Compose uses ignored `*.local`
files in its source root; archive installs supply paths in the deployment parent.

## Authoritative recovery

After quiescence, automatic recovery stops and verifies only current-project
`hms-migrator` one-off containers, using exact Compose project, service and
one-off labels. An interrupted Docker client must not leave a migration job that
can commit after a rollback probe. Failed orphan cleanup keeps recovery closed.
No unrelated containers are stopped, pruned or removed.

Before any rollback tree move or runtime restart, the installer probes with the
candidate image's `hms-migrator schema-compatibility` command. It emits exactly
one decimal epoch: `0`, `202610170023`, `202610170024`, `202610170025` or `202610170026`. It creates no schema,
identities, policy or audit data. The DB helper uses a read-only transaction,
bounded statement/lock/idle waits and SQLx's actual migration advisory lock. Its
dedicated connection closes on every path, including cancellation, so a session
advisory lock cannot escape into the pool. The command has an overall timeout
and returns only generic diagnostics, never credentials or database identity.

Committed migration metadata and the corresponding layout must agree. Failed,
missing or malformed probe output cannot authorize recovery. Reachable DB
metadata is authoritative: if the attempted migration rolled back before the
breaking epoch committed, a compatible epoch-zero artifact may be restored even
though the conservative attempt fence records 023.

When the database is incompatible with the previous artifact, writers stay
stopped and both release trees remain as recovery anchors. Recovery requires a
reviewed compatible forward artifact, or a separately authorized and reviewed
database restoration. The installer never restores a database or deletes
clinical/window evidence to make an old uniqueness constraint fit. The existing
`--skip-migrations` rollback switch does not bypass compatibility checks.

Each new breaking migration must update the explicit DB registry, shell epoch
parser/candidate boundary, runtime declaration and regression tests together.
Additive migrations do not silently advance this reviewed breaking epoch.

## Verification boundary

Copied production-shell regressions run in temporary roots with mocked Docker.
They verify gate ordering, durable intent, drain failure, strict parsing,
pre-quiesce source-only restoration, incompatible/compatible recovery and
project-scoped orphan cleanup. Actual local kernel/process tests cover competing
entrypoints, nested FD inheritance, termination, forged descriptors, legacy lock
refusal, and a competing Compose attempt during rollback recovery. The copied
helper substitutes only its fixed canonical host paths with temporary host paths;
production has no alternate-lock environment bypass. These are control-flow and
local-kernel checks, not live image or
deployment evidence. Separate actual migrator-binary tests use isolated Docker
Postgres databases to verify read-only epoch output, no provisioning, failed
metadata, metadata/migration-lock deadlines and diagnostic privacy. Full release
acceptance and real host readiness remain separate gates.

Checkpoint17 adds actual native database3/migrator5/API1/worker1 passing contracts,
including old023 refusal before provisioning/readiness, current024 startup,
checksum/layout failure, bounded waits and static diagnostics. Its complete local
ops execution passes151 cases with four existing opt-in skips. These current
results supersede the older counts below; they do not establish a live deploy or
host rollback drill.

The final owned gates passed 32 copied-shell schema cases, 18 actual local
lease/process and guarded-recovery cases, and all 146 enabled ops regressions.
Four pre-existing Docker proxy runtime cases were skipped because their explicit
opt-in was not enabled; no new proxy behavior is claimed. The four actual
migrator-binary tests passed against isolated Docker Postgres databases. Shell
syntax and owned diff checks also passed. These results do not authorize or
claim a remote deployment, host rollback drill or automatic database restore.

## Breaking referral consultation boundary

Migration202610170026 adds immutable referral consultation links and request
receipts, retained encounter identity, and admission encounter/visit bindings.
The new runtime requires026 before provisioning, listening or worker readiness.
Its bounded read-only probe checks the embedded checksum and committed metadata,
every essential column type/nullability, enabled scope/immutability/deferred
completeness guards and the actual keys of seven valid/ready indexes. It does not
certify arbitrary SQL function bodies or all operator modifications.

The deployment protocol recognizes026 explicitly, requires the complete preceding
breaking-migration chain and refuses recovery to an epoch025-or-earlier runtime
after026 commits. Old binaries are not assumed to discover future migrations.
The current copied-shell and local-process ops gate passes161 tests with four
existing opt-in skips. Actual026 focused gates pass21 cases: database8, migrator7, API3 and worker3.
The schema/migration fingerprints stay unchanged through the run. New API and
worker processes refuse epoch025 before provisioning/readiness and accept026.
Neither local gate establishes a live deploy or rollback drill.
