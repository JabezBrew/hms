# Appointment groups and fluid observation lifecycle

Status: local regression acceptance passed; rendered browser and staging checks
remain pending approval. This is an implemented checkpoint, not full Python
parity or production clinical approval.

## Behavior

Appointments can be booked as an explicitly reviewed group of 2–50 real session
slots within 180 days. One atomic request rechecks active references, slot grids,
capacity and exceptions. A later conflict leaves no partial group. Stable request
references support exact replay and lost-response lookup. The reachable booking
dialog reviews every occurrence and links to the saved group. Future cancellation
uses an opaque membership snapshot and an immutable receipt; past and arrived
appointments remain historical evidence. Session exceptions, rescheduling and
arrival share compatible locks. This does not yet implement recurrence-rule
expansion, timezone/DST rules or automatic future scheduling.

Chronicle fluid balance supports paired measured volumes, typed categories,
metadata, corrections, voids and complete effective totals. Corrections append
evidence; original values, reasons, actors and recording times remain reachable.
Voided roots remain discoverable through an explicit history option and never
contribute to effective totals. Stable UUID commands and guarded portal/host
lifecycle preserve uncertain requests through ordinary panel dismissal while
patient or durable access changes clear copied clinical drafts. Hidden panels
contain no dialog content or focus targets and do not refetch.

Versioned facility monitoring rules feed server assessments and indexed daily
ward-board projections before pagination. Unconfigured, disabled and no-data
states remain distinct. Current-day assessments are explicitly partial. A
cross-day correction updates both day counters atomically; the board cache also
rolls at UTC midnight. Derived conditions do not replace manual nursing alerts.

## Local acceptance

- Frozen index snapshot `/tmp/hms-phase5-index-review`: **377 Rust tests passed**,
  zero failed/ignored, 79 result groups, using isolated Docker Postgres databases.
  Formatting, native API/migrator compilation and byte-identical OpenAPI
  regeneration pass.
- Full frontend: **1,545 tests passed in 236 files**. Lint has zero errors and
  72 warnings. Generated-client check, Rust-mode production build and bundle
  budgets pass: startup 60.93 KB gzip, entry JS 30.09 KB, CSS 30.84 KB, largest
  lazy chunk 115.05 KB gzip; no initial chart chunk.
- Independent source/focused checks cover booking and exception races,
  all-or-nothing rollback, stale cancellation snapshots, authorization,
  correction concurrency, audit rollback, paired history, UTC projection changes,
  no-data boundaries, pre-page filtering and real Chronicle host close/reopen.
  Changed-source React Doctor checks have zero errors; reviewed complexity and
  intentional frozen-snapshot warnings are maintainability feedback.
- Direct native HTTP acceptance: **43 checks passed**. Created two actual
  capacity-backed sessions, booked a group, replayed the same request, recovered
  it by request reference, rejected changed content, cancelled both future
  members and replayed the identical cancellation receipt. Synthetic sessions
  were closed afterward; booking/cancellation history remains.
- The same HTTP run recorded paired intake/output, replayed creation, verified
  aggregate deltas, corrected volumes and observation date, retained both paired
  versions, voided the replacement, replayed its fixed revision and verified
  exact baseline effective totals. The voided root remained discoverable.
  Facility rules were versioned/replayed, used by a partial-day assessment, then
  the prior values were restored as another version. No clinical history was
  deleted. Anonymous series and fluid access returned 401.

## Pending and remaining boundaries

Automatic approval review rejected browser navigation to the new local preview
origin `http://127.0.0.1:4179`, requiring user confirmation. It also rejected the
checkpoint-four source upload to the existing synthetic host because destination
ownership was not established from trusted user instructions. Both approvals
are pending. No alternative browser surface, port workaround or indirect upload
was attempted. Builds, UI regressions and native HTTP evidence above are local;
there is no rendered phase-five or new live-release claim.

The separate trusted-network security implementation is excluded from this
checkpoint's accepted snapshot. The existing header-based offsite bypass is
documented and its replacement remains under independent review. External
delivery/integration, strong second-factor login, continuous realtime and the
broader ledger remain incomplete. See the appointment-series and fluid scope
documents for explicit clinical and scheduling boundaries.

Evidence: `/tmp/hms-phase5-index-{rust,frontend,lint,build,bundle}.log`,
`/tmp/hms-phase5-index-{native,fmt,client-check}.log`,
`/tmp/hms-phase5-oas-roundtrip.log`, `/tmp/hms-phase5-http-acceptance.json`,
`/tmp/hms-fluid-host-independent.log`, `/tmp/hms-series-independent-frontend.log`.
Only reviewed snapshot blobs and this evidence documentation are committed.
