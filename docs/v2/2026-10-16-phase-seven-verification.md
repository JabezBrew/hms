# Prescription courses and scoped nursing workflows

Status: frozen local backend, frontend and native HTTP acceptance passed.
Browser and staging remain pending explicit approvals. This checkpoint does not
complete the Python parity ledger or establish production clinical approval.

## Resulting behavior

Prescription instructions and reason persist on create and remain in protected
clinical detail; lean medication lists do not expose them. Pre-course scheduled
documentation edits use a reviewed source token and a stable request UUID.
Replacement stops an active/held source and creates one explicitly reviewed new
course atomically. Renewal requires a terminal source and preserves its terminal
state. Neither action generates doses or supplies stock. Terminal source status
cannot be resurrected through the old PATCH path. Immutable actor-bound request
receipts support exact replay and authoritative recovery after later changes.

Linked PRN courses share actual dose history and unresolved-dose protection.
An explicitly reviewed successor's limits apply to that shared history; a new
course cannot silently reset interval or 24-hour counters. Read eligibility uses
the same group and correctly computes availability after a stricter reviewed cap.
Imported whitespace/case PRN labels retain policy checks and stock multipliers.
Mixed scheduled/PRN linked transitions remain explicitly unsupported.

New detail, documented create, edits, courses and receipts require explicit full
clinical visibility in addition to normal facility/feature/permission and patient
access. Source/group/stock/context locks and current actor/session/version/deadline
fences prevent a waiting command from outliving authority. The selected visit is
locked and rechecked after checkout waits. Generic failure stays unconfirmed.

The Chronicle UI supports fresh detail, explicit source reuse, full proposed
regimen review, deliberate dates/stock selection and same-request retry/recovery.
A validated immutable recovered receipt acknowledges only its original opaque
attempt marker. Failed/missing/malformed lookups do not unlock new writes. Real
Rust login shapes, feature names and full-clinical visibility are covered; local
synthetic fixture access is explicit, with no production-default broadening.

Treatment headers, manual alerts and shift headers have typed bounded server
filters before cursor paging. Current critical alert previews request open
high/critical rows before LIMIT; overflow is explicit and links to the actual
ward-board urgency view. Failed previews do not replay cached clinical toasts.
Keys retain opaque scoped filter hashes. Signal/AbortError and page metadata
survive adapters; no whole-facility client filtering is used for these lists.

Nursing writes require the Nursing feature plus the intended workflow access.
Handoffs validate active same-facility ward/recipient references under transaction
locks. Only the sender finalizes a shift header; repeated finalization preserves
its receipt. This is not recipient acknowledgment or patient narrative parity.
Alert acknowledgment atomically preserves the first actor/time and audit;
concurrent/repeated acknowledgment cannot rewrite that provenance.

## Focused and independent evidence

- Prescribing: 57 focused Rust checks (40 repository/lifecycle/PRN, 17 HTTP),
  including natural managed-authority expiry, session revocation, source/stock
  conflict, rollback, shared-group races, Unicode bounds and real visit checkout.
- Nursing: 6 repository, 11 HTTP and 61 frontend checks. A forced generic prepared
  query plan over 5,000 critical alerts uses the dedicated partial cursor index
  without sorting. Bounded request count alone is not claimed as constant work.
- Prescribing frontend: 121 focused tests, plus 44 independently rerun API/model/UI
  checks. Root transport/opaque metadata regressions: 44 tests. Feature-scoped
  lint and independent source reviews found no remaining confirmed blocker after
  the recorded repairs. Doctor reports zero errors, with reviewed complexity and
  query-result compatibility warnings.

## Frozen checkpoint acceptance

- Rust workspace: **464 passed across 88 result groups**, zero failures or
  ignored tests. Formatting passed. The old repository test that expected
  stopped-to-held resurrection now requires rejection and a retained stopped
  source; the complete workspace passed after that correction.
- Frontend: **1,722 passed across 252 files**. Full lint reports zero errors and
  72 reviewed existing warnings. Generated-client check, Rust-V2 production
  build and all bundle budgets passed. Startup gzip is 65.96 KB (35.04 KB entry
  JavaScript and 30.92 KB CSS); the largest lazy chunk is 115.05 KB. No chart
  chunk loads at startup.
- OpenAPI: byte-identical regeneration from the frozen source, 436 operations,
  2,921 resolved local references and no dangling reference.
- Native synthetic API: **57 HTTP checks passed**, covering persisted protected
  documentation, lean list DTOs, snapshot conflicts, immutable receipt replay and
  recovery, stopped-source rejection, replacement and terminal renewal, actual
  stock issue/administration and shared PRN interval continuity across successor
  courses. An empty location first rejected supply; the accepted run explicitly
  selected stocked Main Store and verified an exact one-unit deduction. Created
  courses were stopped after acceptance; clinical and stock history remain.
- Explicit local clinician fixture access was audited and permission-versioned;
  no source or production-default clinical visibility was broadened. All 86
  native database migrations succeeded, with latest version `202610160014`.
- Warm local debug read smoke: all 500 requests returned 200, five concurrent
  callers per route. Observed p99 milliseconds: identity 40.35, registry 62.89,
  Chronicle 75.50, scoped fluid summary 7.39, catalog 3.96. Concurrent local test
  work was active. These figures exclude cold start, browser, edge and production
  capacity; the earlier cold staging tail limitation remains open.

The frozen source is `/tmp/hms-phase7-index-review`; 85 staged path blobs match
that snapshot, including the corrected repository regression. Phase-eight work
is excluded from this checkpoint. Native API SHA-256:
`7f481c5288a2e7af5b62094f38d964f1654a026ae9b4b04a88e06ea1d672d60e`;
migrator SHA-256:
`9b439843922a4ab80b97da85798bf2fe6d641e8a521f0e18f40dcfa64c065c57`.

Evidence: `/tmp/hms-phase7-index-rust-final.log`,
`/tmp/hms-phase7-index-frontend.log`, `/tmp/hms-phase7-index-lint.log`,
`/tmp/hms-phase7-index-client-check.log`, `/tmp/hms-phase7-index-build.log`,
`/tmp/hms-phase7-index-bundle.log`, `/tmp/hms-phase7-index-openapi.log`,
`/tmp/hms-phase7-http-acceptance.json`,
`/tmp/hms-phase7-native-migration-acceptance.json`,
`/tmp/hms-phase7-read-perf.json` and
`/tmp/hms-phase7-index-tested-manifest.json`.
These local artifacts are execution evidence, not patient data exports.

## Remaining boundaries

Ordinary basic-create care-context lifetime and scheduled-medication stock-unit
lifetime need their own follow-up. Standalone hold/stop reason governance,
treatment/supply regimen parity and patient narrative handover remain incomplete.
The separate dependency advisory rescan records zero npm findings and the known
inactive Linux rsa lockfile advisory; it is not an application-security guarantee.

Automatic approval review still requires confirmation for local preview
`http://127.0.0.1:4179` and for source upload to existing synthetic staging.
No new rendered-browser or live-release claim is made. Live remains verified
checkpoint3 commit `67b9dc9dc07082ecadb3a81d26a651a476f374d8`.

See the prescribing-course and scoped-nursing scope records for contract detail.
