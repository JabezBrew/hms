# Organization unit maintenance — combined local acceptance

Checkpoint20 shares final local acceptance with checkpoints21 and22. Frozen
checkpoints18 and19 retain their separate evidence and tested source.
Membership, leadership, cross-coverage, rosters and configurable unit types remain
separate parity work. No new clinical access grant follows from this maintenance
slice.

The implementation adds strict UUID/CAS create, rename, retire and reactivate
commands to the existing Rust organization surface. Facility, id, code, type,
parent and original creation time remain immutable after creation. Changing active state
refuses any recorded child, position or organization-scope permission reference,
including inactive/historical references, with a static actionable blocker
category. This also prevents legacy inactive-unit reactivation from silently
restoring authority through retained positions or scope assignments. New references and reactivation require the actual retained active
same-facility parent/unit. No cascade, physical deletion or implicit staff access
change is offered.

Writes and original actor-bound command receipts use current Admin and
AdminAuthorityManage plus the existing privileged session/factor/network proof,
retained source locks and final database clock. Ordinary directory reads retain
the current administration read permission; browsing does not require fresh
privileged factor proof. Typed reviewed input uses canonical sorted-key JSON for
its digest. Original receipts remain immutable after later unit changes; exact
state no-ops preserve version and transition timestamps.

The Rust UI uses a bounded cursor directory at the existing administration route.
It does not reconstruct a claimed whole tree from the first100 rows. Supported
fields and explicit lifecycle review replace legacy controls that silently
discarded input or called unsupported mutations. Membership and coverage views
must disclose their missing Rust contract rather than fabricate an empty success.
Real Rust permission and feature facts govern route/sidebar/page access; an
administrator role cannot substitute for the server capability.

Actual baselines already captured include create/detail200 with four missing
maintenance/receipt routes404; Rust-capability entry denied while role alone was
accepted; discarded next-page information; inactive child creation under a
retired parent; and baseline seeding failing after a real governed rename. The narrow
repairs pass the final combined verification. Organization defaults now retain exact compatible
identity and preserve maintained name/version/timestamps; incompatible or retired
configuration refuses, and demo cleanup must preserve organization identity.
No guard is disabled to make historical fixtures pass.
An honest pre027 inactive-unit fixture also reproduced scoped position authority
restoration0-to1 after canonical reactivation200, with the target permission-version
unchanged. Both-transition reference refusal repairs this edge. This observation
is about the exact organization-scoped authority projection, not a demonstrated
facility-wide or clinical grant.

Migration202610170027 is a breaking runtime boundary. The startup probe checks
the embedded committed checksum/previous chain, typed nonnullable command layout,
unit version, enabled exact guard functions/events and real index keys/predicates.
The supported deployment protocol refuses026 rollback after027 commits and the
new runtime refuses schema026 before provisioning/readiness. Earlier binaries
are not assumed to recognize future migrations. This probe does not attest
arbitrary function bodies or every operator alteration.

| Gate | Current result |
| --- | --- |
| Ops protocol baseline |Seven actual new-epoch failures and three existing positive controls against unchanged prior registry |
| Complete local ops |181 pass, four existing opt-in skips on the combined028 source; captured production controls unchanged |
| Backend lifecycle, source races and seed replay |34 focused passes:26 actual HTTP, seven repository/provisioning and one production reference-query plan control |
| Startup/layout/CLI/API/worker controls |26 passes: database10, migrator8, API4 and worker4; captured source unchanged |
| Actual generated contract | Final511 operations/417 paths/1142 schemas/3680 resolved references; Rust export and deterministic client check pass. Original503 client separately proves eight-method forward compatibility against accepted028 binaries |
| Full combined frontend |3077 tests/343 suites, zero failures; lint/build/client/budget pass;1633 frozen paths unchanged,71 owned paths reviewed |
| Full combined backend |1027 tests/150 targets, zero failures and ignored tests;635 backend/3405 context hashes unchanged, format/native binary build/actual emitted contract pass |
| Organization native |124 functional assertions over45 functional HTTP calls;549 assertions/469 total calls including warmup and400 measured protected reads, all pass. Read-only persistence verifies seven commands/audits/exact receipts, one no-op and unchanged complete authority appointments |
| Local protected-read sample |24 warmups then400 requests at concurrency4, zero errors; p50/p95/p99 2.258/3.139/32.672 ms. Loopback with isolated Docker Postgres/Redis, pool10; no production or clinical latency acceptance |
| Rendered browser/physical authenticator/staging/production p99 | not accepted |

Final local acceptance binds the real emitted contract, exact frozen source,
full/focused regression evidence, original receipt recovery and native persistence. Ordinary unit reads cannot acknowledge an uncertain command; only
an actual current original actor/request receipt may establish review. Shared
denial, dispatch, read-lease and asynchronous proof fences remain required.
Browser navigation and remote staging retain the previously reported automatic
approval-review blocks.

The reference blocker uses one combined production SQL statement. A real plan
control with10,000 synthetic rows in each branch observes the three intended
indexes. This is query-shape evidence; canonical actor locks may wait, and no
whole-command or production p99 result is claimed.

Actual frontend regressions reproduced a parent-picker403 retaining a selected
parent and a paused preparation digest publishing an older review. A later
control held the clock constant and reproduced the refresh race despite an equal
dataUpdatedAt timestamp. The repair observes actual query data/error identity
alongside the timestamp and invalidates committed review state before paint.
The permanent same-clock controls and final2,830-test full suite pass; their
source and logs are recorded separately from the superseded run. Server CAS remained required
throughout. Ordinary directory responses cannot establish an original command's
outcome or acknowledge an opaque recovery notice.

The final combined entry bundle is40868/40960 gzip bytes, with startup72651/92160
bytes, five preloads and no initial chart chunk. No budget was raised. The
supported68-input Doctor scan has zero errors/seven warnings, score86 and
baselineDegraded=true. Different scan scopes and degraded baselines prevent a
numerical comparison; Doctor does not establish rendered accessibility or usability.

## Combined-release follow-up

Checkpoints20,21 and22 share the final frozen local release acceptance. The old full
collection exit101 remains recorded; its one failure attempted to reopen a
completed encounter in a fixture. Two already reviewed test-only fixture files
replace their complete10/14-test targets, including the robust password-setup
fixture from checkpoint19. This is979 reconciled tests, not an original clean
workspace collection.

The first native organization run completed68 assertions before a malformed body
produced an unparsable response. Static extractor envelopes repair that product
defect. A later attempt stopped after118 assertions because its harness compared
a current joined parent display name with an immutable receipt after deliberately
renaming that parent. The repair compares every other leaf field exactly, checks
the new current parent name and rereads the unchanged original receipt. A third
attempt passed HTTP but incorrectly expected zero authority appointments, despite
the honest baseline creating a baseline_owner appointment. The final harness
compares every appointment column through an ordered canonical digest/count
before and after HTTP. All failed attempts and owned stopped-process evidence
remain preserved. No baseline owner, guard or product fixture was removed.

The accepted organization run uses the frozen503-operation SDK against the final
accepted028 binaries: actual026 baseline, honest pre027 synthetic history, then
100 migrations through028. Required operation methods/paths/body/response closure
are compatible; new optional query metadata and static400 declarations are
additive. This is scoped old-client compatibility, not full original027 acceptance.
Both native APIs stop and close their owned ports after verification.

Independent review also found query-location and nested enum-closure metadata
discrepancies. Query objects already passed through generated runtime; this was
not runtime filter loss. The final actual511 export repairs those declarations
and strict tagged unit shapes. Shared denial, cancellation, storage-fault and
cross-family note-receipt controls pass on the accepted frontend. Full combined
backend/frontend and native results supersede the intermediate failures without
erasing their original logs. See the checkpoint22 verification for exact hashes
and shared recovery controls. Browser navigation and remote staging retain the
reported automatic approval-review blocks.
