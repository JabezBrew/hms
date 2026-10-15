# Clinical quality phase — 14 October 2026

Status: implementation and functional verification complete; performance
acceptance not met; live deployment blocked.
Scope: active Rust V2 backend and React/shadcn clinician workspace.

## Result

This phase fixes verified workflow, access-control, authentication, accessibility
and performance defects. Six agents implemented and independently reviewed the
changes. The latest upstream revision was incorporated before implementation;
it already removes all GitHub Actions workflow files and the CI badge.

## Clinical workflows

- Triage supports waiting, assigned and completed work, bounded paging,
  encounter-preserving Chronicle navigation, and nursing-authorized staff
  selection. Failed vital writes retain measurements and offer explicit retry
  or discard. Assignment and assessment preserve a valid treating relationship.
- Ward-round drafts restore saved documentation and actions before editing.
  Confirmed versions survive partial-save failures so subsequent retries do not
  overwrite acknowledged work.
- Laboratory verification completes an order only after every requested test
  is verified. Cancellation, result entry and verification serialize on the
  parent order; retries preserve first-verifier evidence.
  Status changes, specimen creation and result writes refresh all affected
  order partitions, including previously cached empty destination lists.
  Native critical results display generic Critical without inventing a high
  or low direction; absent interpretation displays Not classified. Critical-tab
  changes commit atomically, and failed reads hide counts and cached results
  until an explicit retry succeeds.
- Medication administration and fulfillment enforce active clinical sources,
  dispense state and same-facility active witnesses. Completed administration
  retries preserve original actor, witness and time. Both dispensing interfaces
  exclude expired batches.
- Medication adapters reject unsupported held, missed and refused writes rather
  than silently converting them to an administration. The legacy status dialog
  exposes only actions supported by the active API.
- MAR generation normalizes PostgreSQL timestamp precision and batches dose
  and fulfillment-link writes. A one-dose and a 186-dose schedule both use
  seven observed queries; retries use six and preserve historical dose state.
- Staff-directory cursors use the exposed user ID, including timestamp ties.
  Encounter practitioner search uses the actual care-team table.
- My Patients derives current assignments from owned encounters and active care
  teams without persisting inferred grants. Linked visits must remain active;
  explicit assignments and legitimate authored history keep their own policy.
- Native encounter-workspace links open the real patient Chronicle after
  checking the returned encounter identity. They no longer display hardcoded
  diagnoses, medication or consultation history, or a local-only note editor.
  Empty allergy lists say No allergies recorded rather than asserting NKDA.
- Admission queues retain the native cursor and offer bounded next, previous
  and first-page navigation. Counts describe the current page, and native
  billing/nursing views show actual case statuses without invented clearance,
  source or bed-reservation facts. Authorization changes reset the queue.
  Detail actions and occupied/reserved bed labels follow actual case status;
  discharged and cancelled cases cannot offer pre-admission or active-stay
  actions. Summary dates use recorded request, admission and discharge times.
- Cash payments submit the current open session ID. Bank transfers and other
  non-cash methods no longer require or associate with a cash drawer in Rust.
- Patient-scoped discharge controls show authoritative clearances, preserve
  failed nursing-release entries and require confirmation before finalization.
  Unknown write outcomes trigger a status refresh before further actions.
  The Chronicle shortcut preserves the admission encounter and summary title;
  an ordinary draft note does not satisfy the final-summary requirement.
  Clinicians can open the full summary, acknowledge their review and record
  a version through the native note API. A fresh identity/version/body check
  rejects known stale reads; the existing API has no atomic expected-version
  guard, and this control does not claim a digital signature.
  Navigation commands open each workspace once while URL cleanup is pending;
  a reproduced render loop no longer repeatedly reopens and resets note forms.
  Final confirmation renders above the ward drawer, so the normal confirm
  control receives pointer and keyboard input.
- Emergency access uses the existing audited native grant/end APIs, dedicated
  permission, category and confirmation. Grant expiry evicts cached records;
  scope changes and uncertain outcomes lock the record until access is checked.
  The observed grant deadline is bounded by the native two-hour lifetime even
  when the browser clock is behind. Periodic and foreground access checks
  continue after permission to request a new grant is revoked, including after
  reload when the server accepts an existing grant.

## Security

Recovery codes no longer panic; password verification runs on bounded workers.
Token refresh does not renew authentication freshness for privileged actions.
Delegated authority is checked against its validity interval on every use.
Login has per-identity throttling and bounded admission, without a timed global
lockout. These counters are process-local; coordinated multi-instance rate
limits remain future work. Reset delivery uses the configured trusted adapter, keeps public
acknowledgements generic, and rejects redirects. Unknown reset accounts cannot
consume the delivery budget.

Direct clinical reads and writes use the same relationship/break-glass checks
as Chronicle. Demographic browsing cannot create a treating relationship.
Authorized pharmacy and laboratory safety projections retain their limited
workflow access, and established care relationships allow historical
post-death documentation. Visit, triage and search caches include opaque
user, active-facility and authorization scope.

Clinical writes no longer retry automatically after a lost response. Nginx
security headers now survive location-specific caching headers and apply to
HTML, runtime configuration, static assets and error responses.
Nginx request access/error logging is suppressed so reset tokens, patient paths
and referrers cannot enter origin logs. Startup diagnostics and safe API
telemetry remain available.

Dependency fixes and deterministic local tooling replace floating tool
execution. The final installed npm dependency audit reports zero advisories.
Rust dependency audit results are recorded in the verification section below.
The [dedicated security audit](../security/2026-10-14-clinical-security-audit.md)
maps findings to implementation and regression evidence, with explicit limits.
The production frontend builder uses Node 24 LTS instead of the retired Node 20.
Public static assets receive explicit read permissions for the Nginx worker;
browser traces, recordings and local authentication artifacts are excluded from
the build context.

## UI and accessibility

The shadcn/Radix components remain in use. Controls now use self-hosted DM Sans,
headings use Cormorant Garamond and clinical data uses IBM Plex Mono. The light
and dark themes use warm neutral surfaces and a restrained bronze action color.

The shell fixes header overlap, mobile navigation dismissal, unnamed controls,
nested main landmarks, input keyboard shortcut interference and silent loading
states. Mounted charts respond to manual theme changes. Desktop, narrow touch
and dark-mode captures use synthetic data only.

Rust dashboards use actual available metrics and bounded work previews rather
than demo patients, fabricated statistics or unsupported all-clear messages.
Doctor/provider compatibility landings reuse the actual My Work workflow.
Scheduling calendars have one named navigation pair, labeled month/year
selectors, explicit date bounds and future-year choices.
Forty-five nested main wrappers across 39 authenticated content files now use
sections; standalone print and authentication views retain their own landmarks.
Appointment details begin their actual fetch immediately, without the previous
artificial 500 ms loading delay.
Forty-six accessible names cover all 43 confirmed active control gaps from the
static audit plus three search fields. Selected views and toggles announce
their state. Twelve appointment and inventory fields now have associated form
labels, including forwarding the actual input ID through the search widget.
Login inbox notifications survive StrictMode render replay and
asynchronous reads without duplicate toasts or automatic mark-as-read writes.
Patient registration keeps long match tables inside a named, keyboard-focusable
scroll region. Duplicate-review controls fit narrow touch screens; the header
wraps by available card width on tablets. Duplicate-review policy and patient
payloads remain unchanged. The maintained mobile Playwright configuration
repeats triage, admission/discharge and emergency-access workflows locally.
The note-template builder reaches an actual review step before saving. Its
final Next control cannot turn into a submit control during the same browser
click, and submitting a valid form from an earlier step cannot bypass review.

## Performance evidence

Initial JavaScript and CSS fell from 212.56 KiB to 174.21 KiB gzip,
an 18.0% reduction. Bundle accounting now includes modulepreloads rather than
reporting only the entry files. Heavy charts remain outside initial loading;
optional preloads run sequentially and respect hidden tabs, Save-Data and 2G.

The initial asset ceiling is a provisional regression guard, not proof that
all runtime performance targets are met. Three quiet 4× CPU browser probes
against the production API image measured shell readiness at 768–915 ms and
warm route readiness at 163–550 ms. All 18 warm transitions used SPA history;
recorded API response status was complete, with no observed errors.

Direct Chronicle loads took 1.420–1.591 seconds, above the provisional
1.2-second first-useful comparison. Runtime-configuration interception disables
the browser's HTTP cache, so these are uncached document loads. Three samples
do not establish route p95/p99. The earlier contended debug-profile capture is
not accepted performance evidence.

The maintained three-minute, five-VU local API smoke passed 391 checks with zero
HTTP errors. All nine latency/payload surfaces met their local limits, with
measured route p99s below 28 ms. The overall gate still fails: Auth/me recorded
five session-user queries across 25 requests against its zero-query warm-session
budget. The API's required 30-second cache lifetime permits cold/expired-session
hydration; this mixed aggregate does not establish a warm-only result, and the
security checks remain intact. Pool-wait samples are unavailable for all nine
groups. Laboratory and billing zero observed counters cannot prove zero actual
DB work; inventory's grouped reads also contain uninstrumented subroutes. Three
query-count and three slow-SQL surfaces remain incomplete.
Local smoke does not establish deployed latency or full-scale capacity.

See [the performance audit](../performance/2026-10-14-frontend-performance-audit.md)
for definitions, measurements and limitations.

## Verification

Final frontend product source: `3538ed17cbc4356610d1a5656d6964b3c3671ffd`.
Subsequent documentation and load-harness corrections do not change these
built application assets.
The production backend image uses the identical backend tree
`050036ae5c707cfd9ef310862b3a00ae55b80ef0` from `3e91b452`.

- Frontend final full suite: 224 files and 1,395 tests pass, including the
  admission-detail and template-review corrections.
- Frontend lint: zero errors; 69 existing warnings.
- Generated frontend API client: current.
- Local production build and bundle checks: pass. Initial JS/CSS is 174.21
  KiB gzip / 662.38 KiB raw; entry assets are 62.75 / 317.99 KiB. Charts remain
  lazy, with the largest chart chunk at 115.36 KiB gzip.
- Actual frontend container: all 19 HTTP/font/runtime-config/cache/security-header
  checks pass without a container hotpatch or shipping private CA, proxy
  environment or test artifacts.
  Image ID: `sha256:04db23a046a11254b6c22e4eebe23e90036911dd52bed3c4d9ef82c434ddfd26`.
  All 307 JavaScript payloads, HTML and their import graph match the locally
  tested build after normalizing exact build metadata and asset-hash references.
  All seven font files match byte for byte. Raw builds differ: local CSS adds
  one unused 27-byte utility discovered in a test file, runtime configuration
  is generated separately, and the Nginx image includes its default `50x.html`.
- Rust formatting and final full workspace suite: pass, 253 tests across 57
  targets, zero failures.
- Native API, worker and migrator builds: pass. Regenerated OpenAPI exactly
  matches the checked-in contract. None of the 338 resolved packages declares
  a minimum Rust version above the production builder's Rust 1.88.
- Optimized release builds for every workspace binary: pass. Local performance
  acceptance uses these optimized binaries, separately from functional tests.
- Actual production Rust 1.88 container: build passes in 15m40.85s. All four
  binaries load as the unprivileged user in a read-only, network-isolated smoke
  container; its generated 310-path OpenAPI exactly matches the repository.
  A separate local API instance passes readiness, login and authenticated-access
  checks without migrations, seeding or search rebuilding.
  Image ID: `sha256:846c75b952193c5fad78389b8574d311525e101be8a361a33b3cb10a9efce1f9`.
- Operations suite: 91 tests pass in a clean local snapshot, including six
  real Nginx header/privacy cases and two linked-worktree/archive-safety
  regressions. A separate negative control verifies error-log leak detection.
- Load-harness tools: 31 network-free tests pass, covering 25 reporter and six
  session regressions. The reporter retains raw observed counters while marking
  unverified actual query/slow-SQL/pool-wait measurements unavailable. Numeric
  budgets remain unchanged.
- npm audit: zero vulnerabilities in the installed dependency tree.
- Pinned React Doctor static audit at `ab991e77`: gate exits 1, with 15 errors and 261
  warnings remaining across 1,088 scanned files. Manual triage distinguishes
  render-ref/state-updater patterns, cleanup false positives and legacy-only
  controls from active defects; this phase fixed the confirmed active naming,
  form-label, clinical-truth and command-replay findings. This static gate is
  not reported as passing, and no finding suppression was added.
- Rust dependency audit: patched Rustls, Quinn, anyhow and event-listener
  advisories and a yanked spin release. The whole-lock audit retains one
  advisory, RUSTSEC-2023-0071 in optional `rsa` 0.9.10, with no patched release.
  Both `cargo tree --locked --workspace --target all -i rsa` and the spin
  reverse tree are empty: these optional SQLx/MySQL dependencies are absent
  from the resolved application build. No advisory suppression was added.
- Final immutable desktop browser run: all 32 workflows pass in 7.1 minutes,
  using the production Rust 1.88 API image through a same-origin local proxy.
  This includes the explicit template review, admission/discharge, laboratory
  transition, appointment-arrival and patient-context regressions. No workflows
  are skipped or retried. Build/unit contention during this functional run
  means its elapsed time is not performance acceptance evidence.
- Final maintained touch suite: all three workflows pass in 43.9 seconds at 390 × 844,
  including an exact-state registration viewport check and ordinary duplicate
  review/discharge control clicks. A separate 1024-pixel check confirms a
  readable, wrapped registration header with no page overflow.
- Actual API/UI clinical safety probe: a guarded, single-row synthetic fixture
  confirms native generic Critical labeling, counts and filtering without an
  invented high/low/Normal interpretation. The owned patient Chronicle displays
  No allergies recorded for its empty allergy list. This fixture tests display
  of the native critical flag, not threshold calculation or result-entry
  criticality detection.
- Actual final frontend container browser check: DM Sans loads for body, labels
  and inputs; all observed font responses return 200, with zero browser errors
  or CSP violations.
- Quiet browser/runtime and read-only API load measurements: completed, with
  the failed/incomplete acceptance results described above. Original budgets
  and readiness markers remain unchanged.

Visual evidence uses explicitly mocked synthetic workspace responses; these
captures are separate from the actual API workflow tests above:
[desktop workspace](assets/2026-10-14-clinician-workspace-desktop.png) and
[mobile workspace](assets/2026-10-14-clinician-workspace-mobile.png).

## Release and remaining work

Use `scripts/check-local.sh` for the local frontend, backend and operations
release checks. Browser workflows, dependency audits, runtime measurements and
live deployment verification remain additional checks.

The workspace can push to GitHub. Live deployment is blocked: no host identity
or private testing-deployment configuration is attached, and the network
policy rejects the staging hostname. No live deployment or live readiness
verification is claimed for this phase. The existing Oracle synthetic testing
runbook remains the deployment path.

Remaining interface limitations: chart writes do not have request idempotency
for lost acknowledgements, and payment/dispensing reconciliation after an
uncertain write still needs dedicated request-idempotency work. Automatic
mutation retries are disabled. Ward-round action replacement is a non-atomic
sequence. Unknown write outcomes continue to fail safely rather than claiming
successful persistence. Held/stopped prescription fulfillment rows may remain
visible until an explicit reconciliation/cancellation workflow handles them.
The new guards reject dispensing or administration from those inactive sources.
The active medication API records administered doses; dedicated structured
held/missed/refused outcomes require a future API workflow. Unsupported adapter
writes fail closed, and the compatibility dialog directs staff to nursing notes.
Structured shift-handoff UI remains unfinished; this phase verifies its API
boundary and the active Ward Board task controls separately. Doctor/admin
background critical-alert aggregation has no supported scoped source yet;
ineffective polling is disabled, while the real nursing alert path remains.

This is a tested implementation phase, not a claim that every feature and
screen in the repository has been exhaustively completed or audited.
