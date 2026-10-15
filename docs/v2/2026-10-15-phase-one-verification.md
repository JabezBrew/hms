# HMS phase one: security, worker reliability, and clinical interface

Date: 2026-10-15
Scope: active Rust V2 and React frontend; synthetic testing only.
Release status: code accepted; staging deployment pending. This is not production or clinical approval.

## Completed changes

- Credential authentication time survives refresh. Refreshing an access token
  cannot renew high-risk reauthentication. Missing or inconsistent evidence
  fails closed.
- Recovery-code generation no longer panics. Password verification, hashed
  storage, and single-use consumption are covered by API tests.
- Atomic database reservations bound login attempts across API instances.
  Password work runs outside database transactions. Abandoned reservations
  expire and stale completions cannot issue sessions or change a newer budget.
- Dashboard refresh jobs recover abandoned leases, retire malformed payloads,
  and bound retries. PostgreSQL-local timeouts limit work; the current claim,
  snapshot write, and job completion are checked atomically. Logs/failure
  summaries use fixed non-PHI codes.
- Restored self-hosted DM Sans for interface text, retained editorial display
  and monospaced clinical data faces, and refined light/dark surfaces, input
  contrast, and primary actions while retaining shadcn/Radix primitives.
- Fixed toolbar/sidebar alignment, keyboard navigation, editor shortcut
  interference, mobile menu behavior, loading/error announcements, and duplicate
  main landmarks. My Work cards use bounded content and descriptive links;
  registration-only facilities can reach Patient Directory.
- Appearance supports light, dark, and the device setting, including persistence
  and device changes. Settings links to the actual clinical-template manager.
- Template creation now requires the Review step and an explicit save. V2
  templates accurately explain facility sharing; unsupported private/role/
  department claims are removed. Descriptions round-trip as non-authoritative
  JSON body metadata, retaining old template formats. Template actions are
  visible and named.
- Frontend dependency remediation removed all 30 reported npm advisories from
  the resolved lock. The local preview uses Vite in place of `serve`.
- Rust dependency fixes update anyhow, event-listener, rustls, quinn-proto, and
  jsonwebtoken. The JWT library uses AWS-LC and retains the Rust 1.88 toolchain
  requirement. A maintained test exercises actual RS256/JWK verification with
  ephemeral keys and rejects invalid claims and signatures.
- Committed-source deployment accepts Git worktrees while rejecting local
  archive attributes in either the worktree or shared Git metadata.
- Medication lifecycle writes share a prescription lock across Chronicle,
  ward rounds, MAR, and dispensing. Hold/resume preserves actual history and
  restores only eligible future source-held doses; stopped courses and stale
  regimen/timing snapshots fail closed. Generated regimens require replacement
  prescriptions for changes. Migration backfill retires unsafe legacy pending
  work while preserving administration and dispensing evidence.
- Prescription forms distinguish saved prescriptions from failed/unconfirmed
  MAR generation, preventing duplicate create retries. Outpatient prescriptions
  default to no MAR; supported duration persists, unsupported V2 renewal/text
  controls are removed, and patient/MAR/pharmacy caches refresh correctly.
- Browser testing found a stale-status cache mismatch after a successful stop.
  Mutations now invalidate the actual patient-scoped Rust Chronicle startup and
  timeline keys, including seeded multi-page views. Old in-flight page reads
  cannot restore stale medication status after the refreshed startup arrives.
- Active medication summaries now use a separate bounded Active-only slice
  inside the existing startup SQL query. Held/stopped/completed orders stay in
  history and timeline; newer ended orders cannot hide older active orders.
  A 5,000-order regression confirms the existing status index is used without
  a sequential scan, preserving the Chronicle request's three-query budget.

## Independent review

The review found and the authors repaired two issues in the initial patch:

1. A read-before-write login counter raced under default concurrency and across
   processes. Cross-instance reservation tests now cover the exact budget.
2. Dropping a SQLx future did not cancel PostgreSQL work, and stale work could
   write a projection. Database timeouts, claim-fenced persistence, and a real
   blocked-row test now cover cancellation, rollback, and pooled-setting reset.

No additional actionable regression remained in the reviewed auth, worker,
shell, landmark, or theme changes. This is a scoped review, not certification
of every existing HMS feature.

A further medication review closed source-writer bypasses, generation races,
retry-count drift, zero-work fulfillment queues, future-start/duration errors,
legacy timing drift, and foreign-facility stock links. The frozen medication
patch passed 32 focused backend and 47 frontend checks before full acceptance.

## Verification

The final backend run passed 252 tests with no failures or ignored tests.
Generated OpenAPI matches the tracked HTTP contract byte for byte.
The final frontend run passed 1,230 tests in 203 files. Local gates include
formatting, lint, production build,
generated API bridge, bundle budget, React Doctor, deployment tests, and
database-backed contract tests against Docker PostgreSQL/Redis.

Browser checks use the real Rust API, an isolated synthetic database, and a
production frontend build. Checked login, My Work, registry pagination,
Patient Chronicle, Settings, template creation, and appearance at laptop and
mobile sizes. The inspected surfaces have one main landmark and no page-wide
horizontal overflow. Dark appearance survives reload; mobile leaf navigation
closes the menu. Screenshots alone do not establish full WCAG compliance.

Early test timeouts coincided with macOS sleep. Those timings are excluded;
acceptance runs are repeated after the host is awake. Bundle transfer is a
static budget measurement, not an end-to-end latency or capacity result.

## Migration and deployment

Apply `202610150001_auth_login_attempt_budgets.sql` before starting the updated
API. The migration is additive and retains active failure budgets. An older
binary can run with the additional table, but it does not provide the new
atomic admission guarantee. Preserve a private database backup, previous
source tree, image tags, and build identity before replacing the test stack.
Also apply `202610150002_prescription_medication_lifecycle.sql` before the
medication update. It adds source-hold and timing provenance and conservatively
retires unsafe pending work; this is a data repair as well as an additive schema
change. Retain the private database backup for rollback.

The current destination is the existing Oracle/Cloudflare synthetic testing
deployment described in `ops/free-testing/README.md`. Do not restore the older
GCP path or change DNS as part of this phase. GitHub Actions remains disabled;
no workflow YAML is present. Deploy only the reviewed committed tree.

## Confirmed work outside this phase

- Password-reset token delivery is not connected to a production delivery
  worker. Do not advertise working reset email delivery.
- Passkey enrollment is not enforced second-factor login or proof of fresh
  passkey possession for privileged actions.
- Client-IP throttling needs a trusted proxy/IP interface. Offsite restrictions
  cannot rely on a client-supplied location header.
- Realtime currently returns an initial delta and closes; continuous fanout
  remains incomplete. Existing polling does not establish live subscriptions.
- Template icon/mode/estimated-step preferences lack complete V2 persistence;
  those controls are hidden in V2. JSON display metadata must never be treated
  as authorization.
- Prescription-to-stock selection needs a bounded clinical medication-catalog
  API and an explicit picker. The existing inventory endpoint requires separate
  inventory access and exposes mixed stock types; no name-to-stock mapping or
  permission widening was added. Free-text prescriptions without a stock link
  cannot be dispensed through the stock-bound fulfillment queue.
- The Rust OSV rescan covers 337 public crate versions. Its remaining match,
  [RSA timing leakage](https://rustsec.org/advisories/RUSTSEC-2023-0071.html), is
  an unpatched lockfile dependency excluded from both ARM64 and x86-64 Linux
  dependency trees. The npm rescan reports zero advisories. These are current
  advisory checks, not a guarantee that dependencies contain no vulnerabilities.
- Broad load/capacity campaigns and every clinical workflow still require
  their own evidence; a successful phase does not mean all HMS features are
  finished.

## Final acceptance and release

- Rust: 252 tests pass; formatting and generated OpenAPI comparison pass.
- Frontend: 1,230 tests pass; lint has zero errors and 71 existing warnings;
  production build, generated-client check, and every bundle budget pass.
- React Doctor: the initial interface diff scored 82/100 with zero changed-code
  diagnostics; the final medication/cache diff scored 91/100 with zero errors
  and two maintainability warnings (one existing large component and the hook's
  added control-flow complexity). These are different diff scopes, not a
  project-wide score improvement or accessibility/security certification.
- Dependencies: npm reports zero advisories; Rust remaining inactive RSA
  advisory is described above.
- Ops: all 84 tests pass from an isolated clean worktree, including the real
  Git-worktree/archive-attribute regression. Unrelated local work is retained.
- Browser: the final production build reaches Review without creating, saves
  only on explicit Create, and retains the description after reload. Laptop
  and mobile navigation, registry, Chronicle, settings, and appearance checks
  use synthetic data.
- Medication browser replay uses the production frontend and real Rust API:
  one prescription is created, duration persists, and hold/resume/stop update
  without reload. The active summary counts follow 4 → 5 → 4 → 5 → 4 while
  stopped entries remain in history. Read-only API checks confirm persisted
  duration and a single saved prescription.
- Read-only local load smoke: five virtual users over three minutes, 1,801
  checks passed with no application errors; HTTP p99 6.53 ms and identity p99
  5.71 ms. This is a focused administrator smoke against a native debug API,
  not remote release latency, all-role coverage, or a capacity result.
- Linux Rust 1.88 image
  compilation, committed release identity, and remote deployment acceptance
  are recorded after release. Rollback anchors are already preserved privately.
