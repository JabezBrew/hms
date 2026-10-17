# Eighteenth checkpoint: admission placement and task routing

Status: complete frozen local backend, frontend, ops and native synthetic
acceptance pass for this checkpoint. This includes92 fixture/seed remediation
checks and the actual contention/recovery regressions.
Complete Python/UI parity, rendered browser acceptance and a live release remain
separate.

## Resulting workflow

Patient Chronicle supports an explicitly reviewed immediate ward or bed move.
The same admission, encounter, visit and original admission time remain intact.
Source beds enter the existing cleaning workflow with the disclosed ward override
or default duration. Each destination is deliberately selected, active, local,
available and unowned. Same-ward bed moves use the same command and evidence.
The reference performs an immediate move; no transfer acceptance/cancellation
state machine is invented.

An inactive source ward or section may release an existing consistent occupied
placement. Exact source ownership, scoped metadata existence, current placement
interval, authority and CAS evidence remain required and retained through commit.
Every destination ward/section must be active, including resources shared with the
source. This explicitly refines the earlier active-source proposal. New admission,
reservation and activation retain their own active ward/section eligibility.

Review discloses all open tasks and assigned-task counts. The supported policy
routes every open task to the destination service ward and clears assignments;
more than500 open tasks refuses the entire move. Original task ward/instructions
and terminal evidence remain immutable. Effective service ward, route versions
and immutable events govern current lists and decisions.

Placement context, exact detail, bounded history and original actor-bound UUID
receipts use retained current facility/profile/session/network proof, Patients
and Admissions, AdmissionManage, Full clinical/demographics and an ordinary care
relationship. Actual current ward assignment or WardBoardViewAll is required;
commands also prove destination scope. Routing open tasks additionally requires
Nursing and NursingTaskManage. Historical reads invent no living/registration
requirement. Routes/handlers remain adapters; orchestration and SQL use the
existing service/access/repository boundaries.

## Placement, Chronicle and UI evidence

Moves atomically close/open placement intervals, advance placement revision,
change bed state, route complete task membership and record immutable evidence.
Existing placements start as observations with an unknown historical prefix;
original ward, time and author are never guessed. Known historical occupancy is
a lower bound, uses one repeatable-read snapshot and stops open intervals at the
fixed occupancy cutoff. That cutoff is not an exact commit-as-of claim for all
requested-range episode counts. Reports disclose partial coverage, current active
capacity and full requested-range rate denominators. Unknown attribution and
zero-capacity rates remain unavailable.

Chronicle startup now produces the actual facility/patient/encounter-to-admission
association. A sole exact case supplies its summary; multiple cases expose
ambiguity rather than selecting latest/current. Active summary includes encounter
identity and placement revision. Ready/cancelled DTOs expose no invented admission
time; the stored original NOTNULL timestamp contract remains unchanged.

Unsent move reviews reset when exact source placement changes. Authorized note
drafts and exact uncertain-write intent survive same-ward physical revision;
real selected ward or authority loss clears protected copies while retaining
opaque recovery barriers. There is no global-remount or all-feature prepared
review refresh claim. Real generated transport and retained Chronicle Host tests
cover the producer/consumer seam.

Lost-payload recovery explicitly reviews current saved state without identifying
the earlier unknown outcome. Two actual fresh protected reads and a separate
acknowledgment create a single-use proof. Current denial, authority/scope changes,
A-to-B-to-A and asynchronous digest/read races invalidate old proof. A narrow
follow-up applies the same lifetime correction to checkpoint17 referral recovery.
Original UUID recovery remains bound to the original actor and complete intent.

## Actual counterexamples and fixes

- The original explicit-admission endpoint returned200 for duplicate ownership,
  a cleaning bed and a bed in another ward; committed counts confirmed each.
  Corrected canonical producers retain selected-bed eligibility before insertion.
- Actual selected-bed waiting allowed a section publisher to commit inactive
  state before an admission still returned200. Reserved activation also accepted
  inactive ward/section controls. The corrected ward/bed/fresh scoped-section
  proof remains retained through commit; active positives and invalid negatives
  pass without weakening assignment or authority.
- Future occupancy extrapolation reproduced in one of five projection tests;
  all five pass with the actual fixed database cutoff.
- A nonempty reviewed task move reproduced deferred-guard SQLSTATE P0001. A
  correlated identifier resolved to an inner route row. Explicit outer task
  aliasing fixes the binding without weakening complete-membership evidence.
- Two inconsistent pre025 facility tuples were accepted before backfill. Narrow
  patient/ward facility preflight now refuses both before migration writes.
- An actual copied025 schema CLI still accepted the epoch after an essential
  move-detail column was dropped. Complete new table columns and critical type/
  nullability checks now refuse dropped/renamed essential layout. The corrected
  actual copied CLI refuses with static diagnostics and no reported epoch.
- Unchanged production source refused inactive source ward/section move-outs in
  two real endpoint tests. The approved activity-only refinement now passes both,
  while four distinct/shared inactive destination variants still refuse with no
  business effects. Occupancy, interval, task, scope, lock and CAS proofs remain.
- A controlled two-case, same-facility UUID race paused the first valid move
  before commit and observed the second request waiting on the unique index.
  An early scoped try-advisory gate now returns bounded Busy without any second
  move/command/task effects; the original first move still commits exactly once.
- Repeating the synthetic performance seed attempted to delete immutable
  placement owners. The seed now serializes its reserved namespace and records
  an atomic configuration receipt. Same-configuration replay preserves history
  and later user work; incompatible or unreceipted data requires a fresh isolated
  database. Actual contention/cancellation and preservation controls pass.
- Actual frontend regressions reproduced acknowledgment/capture after denial,
  scope transitions and delayed successful response parsing. Private dispatch
  leases and post-await proof checks repair these races without PHI persistence.

Independent reviews and actual regressions cover the placement/security scope.
They do not establish a live deployment or whole-product security certification.
The historical-patient fixture initially lacked a genuine care relationship;
existing startup already accepts Summary or Full. No extra Summary grant or
visibility-policy relaxation was used to satisfy that test.

## Verification

| Gate | Accepted result |
| --- | --- |
| Focused backend |54 placement/schema cases including the new actual UUID contention regression; separate fixture/seed remediation92/92; formatting passes |
| Frontend |2,631 tests across322 suites; zero unhandled errors; lint/build/client/bundle checks pass |
| Frontend diagnostics |0 lint errors/72 existing warnings; Doctor0 errors/10 warnings in the supported74-path recovered scan; score84, baselineDegraded=true; no comparable-baseline nonregression claim |
| Bundle | Entry39.94/40KiB gzip; startup70.96/90KiB; every budget passes |
| Local ops |156 pass, four existing opt-in skips |
| Generated contract |496 operations,403 paths,1,104 schemas,3,525 resolved local references; compiled output byte-identical; generated client check passes |
| Frozen full Rust workspace/native binaries |914 pass, zero failed/ignored across142 target summaries; formatting/native bins/exporter pass; source unchanged |
| Native synthetic HTTP/persistence/migration |52 checks and400 protected warm requests pass;97 migrations/epoch025; independent read-only persistence passes |
| Rendered browser/physical authenticator/live deploy | not accepted |

The recovered ops run had two subprocess fixture deadline expirations during
concurrent local compilation. Its harness now allows30 seconds of process
startup overhead; fake-clock assertions still check the product deadline. The
complete156-case rerun passes with unchanged production shell source.
Two old positive nursing fixture files needed the real service ward/route-version
fields. An old pharmacy test needed explicit unmount/deferred focus cleanup before
restoring globals. The final whole frontend run has no suppressed/unhandled errors.
Earlier partial runs and the recovered898-pass/13-failure run remain superseded
evidence. The latter exposed outdated mutation fixtures and the real seed replay
error. Those fixtures now use canonical placement/lifecycle evidence with all
guards enabled. The complete corrected frozen backend rerun passes with its exact source unchanged.

Actual whole-command one-task and500-task moves both commit with43 observed
explicit repository SQL roundtrips, excluding BEGIN/COMMIT and internal trigger/
FK SQL. This establishes bounded repository call count, not production p99.
OpenAPI SHA256:
`f609a8f7d704047fdd5e86257afeba037045dbcbac41d22dba9856fa69746a79`.
Locked ordinary build/runtime graphs for local and two Linux targets exclude the
unpatched RSA advisory dependency; this is a narrow reachability result, not a
complete implementation audit. The current OSV lookup of all337 registry lock
package/versions reports only that optional RSA advisory. Frontend production
npm audit reports no advisories.
See the dependency-reachability review for exact limits and first-party source.

## Runtime boundary and remaining acceptance

Migration202610170025 is breaking: older024 runtimes do not maintain placement or
effective task routing. API and worker require025 with coherent committed embedded
checksums, essential layout/types, enabled deferred guards and reviewed index keys
before provisioning/readiness. The bounded read-only probe does not attest
arbitrary SQL function bodies or every possible operator alteration. The supported deployment protocol refuses old-runtime rollback after025; host
lease, drain and recovery anchors remain. Old binaries are not assumed to
recognize migrations introduced after their build.

Native acceptance used an owned fresh isolated Docker database and named synthetic
actor with explicit persisted permissions plus actual source-ward staff/
practitioner assignment. They perform real create/reserve/activate, assigned tasks,
two moves, all six actual generated SDK operations, original receipts and readonly
persistence checks. The400 protected warm requests all return200; these synthetic
workstation measurements do not establish production p99. Source-only script
review found and corrected the missing assignment before execution. Preparation
modifies no primary database or human account. Software P256 test signing is not
physical authenticator acceptance. Browser navigation and remote staging remain
subject to the previously reported automatic approval-review blocks.

The native harness corrected two fixture assumptions: nursing decisions require
an empty body, and the initial physical placement starts at revision2 after
activation, with the two verified moves ending at4. The complete52-check HTTP
run and400 warm reads passed before the final independent read-only check.
The corrected read-only continuation reused the same owned database and copied
binaries, verified all persisted tuples/receipts and restarted only its owned
API for schema/readiness proof. Initial attempts remain preserved locally; no
production source or accepted test guard was changed for these harness repairs.
