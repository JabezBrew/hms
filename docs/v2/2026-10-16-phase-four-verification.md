# Fourth parity checkpoint

Scope: source-linked PRN medication, named dispensing locations, real standing
stock requests and conserved issue, and inpatient clinical-context compatibility.
This is an incremental checkpoint, not completion of every parity-ledger phase.

## Behavior

Prescribers enter explicit PRN interval, rolling 24-hour maximum, indication and
whole stock units per dose. There are no inferred clinical defaults. The selected
catalog unit is checked under lock and captured; stale units require review.
Configured regimens stay immutable. Existing unconfigured PRN orders remain
readable without becoming actionable. No fixed PRN MAR schedule is invented.

Nursing requests one indicated dose with a stable command UUID. Source/admission/
item locks enforce one pending dose, actual administered-time interval/cap and
source start/duration bounds. Pharmacy supplies actual linked stock. Repeat
requests reopen the existing fulfillment while preserving prior quantities,
actors and MAR decisions. Supply and administration recheck the source/policy;
nonadministration never invents administration or reverses stock already issued.
Unknown request/supply/create responses block duplicate writes and refresh scope.

Dispensing now uses an explicit searchable, paginated named-location picker.
The minimal endpoint returns only active same-facility id/code/name under the
existing pharmacy permission and feature guard; pharmacy staff do not gain
inventory browsing rights. Confirmation shows the actual linked product/unit and
patient identifier. It blocks changed PRN units and keeps header/footer reachable
around a scrolling form on laptop/mobile screens.

Standing templates contain versioned item/unit/quantity and two active locations.
Due generation atomically captures a unique occurrence, immutable request lines
and schedule advancement. Explicit approval precedes all-or-nothing FEFO stock
issue. Paired signed movements, preserved lot/expiry and allocation evidence
commit with fulfillment and audit. Replay is immutable, including coherent
concurrent issue-versus-generation reads. Cancel/pause/resume and unknown-write
states are supported; old metadata-only requests remain read-only in the Rust UI.

Browser testing found that real seeded inpatient encounters could not cross the
typed prescribing context: the read enum omitted inpatient and historical
finished status. Additive inpatient classification and a completed read alias
preserve these records; completed list filters include both spellings. Real HTTP
PRN fixtures now pass the same inpatient encounter/admission context as Chronicle.

## Acceptance

- Exact index snapshot `/tmp/hms-phase4-index-review`: full Rust **353 passed**,
  zero failed/ignored, 75 result groups, isolated Docker Postgres databases.
  Canonical formatting, generated contracts and native API compilation pass.
- Frozen frontend: full **1,493 passed in 229 files**. The final singular-dose
  wording delta also passes 22 focused tests. Lint has zero errors and 72 warnings
  (71 preexisting plus one pure form-helper export). Rust-mode production build,
  generated-client check and bundle budgets pass. Changed-file Doctor checks have
  zero errors; complexity and existing lookup warnings are reviewed maintainability
  findings, not a security/accessibility certification.
- Independent reviews covered source/policy locks, stock-unit races, interval/cap
  checks, atomic issue/conservation/replay, least-privilege location access,
  context changes, permission loss, uncertain writes and mobile controls.
- Real browser created a standing template, generated a populated request,
  approved and issued one tablet. Independent stock reads verified source -1,
  destination +1, total unchanged, and original lot/expiry preserved. A synthetic
  50-unit batch was first received through the authorized stock API as test data;
  these checks do not claim procurement parity. Mobile 390×844 had no horizontal
  overflow and dispensing Cancel/Confirm controls were within the viewport.
- Real Chronicle created the configured PRN order, requested a dose, selected the
  named pharmacy location and confirmed supply. Refusing that supplied dose kept
  its history and stock evidence; a second request reopened the same source
  fulfillment without resurrecting the refused dose. The second named-location
  supply was administered in the MAR. Independent reads confirmed two distinct
  doses on one fulfillment, Refused then Administered, two retained stock issues,
  correct actor/time evidence, actual administered count one and a six-hour next
  eligibility guard. Stock totaled 48 after two actual issues from the synthetic
  50-unit receipt. The test prescription was stopped and standing template
  cancelled afterward; history remains intact.

## Remaining boundaries

Controlled and fractional-unit PRN, multi-batch pharmacy dispensing and automatic
standing-template generation are not implemented by this slice. Explicit manual
standing issue is complete; no background scheduler is claimed. The broader
clinical, administrative and external integration backlog remains in the ledger.

A separate review confirmed that existing network restrictions trust a caller
header and ordinary mutating routes do not all enforce offsite policy. Trusted
connection/proxy provenance, facility policy and central enforcement are being
implemented as a priority follow-up. This checkpoint is not production security
approval; the release target remains the existing synthetic staging system.

Evidence: `/tmp/hms-phase4-index-{rust,frontend}-acceptance.log`,
`/tmp/hms-phase4-index-{lint,client,build,bundle}.log`,
`/tmp/hms-phase4-context-db-test.log`, `/tmp/hms-phase4-final-copy-test.log`,
`/tmp/hms-pharmacy-locations-api.log`, `/tmp/hms-pharmacy-picker-independent.log`.
Exact staged blobs are compared with accepted snapshot files before commit.
