# Scheduled stock, patient handover and clinical visibility

Status: frozen local acceptance and independent reviews passed. Browser and
staging verification remain pending the
previously requested approvals; this record does not claim complete Python parity.

## Resulting behavior

Stock-linked scheduled prescribing requires an explicitly reviewed positive whole
inventory-unit quantity per dose. The immutable source/course/MAR policy captures
its unit; pharmacy issues a number of doses and the server computes the physical
quantity with checked arithmetic. Actual administration requires matching supply
evidence. Legacy sources remain unconfigured until a reviewed replacement or
terminal renewal; no historic quantities or text-based conversions are guessed.
PRN retains its separate policy and shared safety history. Ordinary prescribing
rechecks its live visit, encounter and discharge/admission context under lock.

Stock receipt compares an explicit expected unit after locking the item. Unit
correction cannot change existing stock or ledger history. Generic medication
selection and dispense reject either controlled flag or controlled item type.
Paired physical quantity/unit evidence is enforced in persistence, including SQL
NULL semantics. Session revocation and natural managed-authority expiry after
database waits reject new medication writes; terminal immutable replay remains
available under the existing authorized contract.

Chronicle now hosts inpatient patient handovers with seven explicit narrative
fields, selected admission context, optional recipient metadata, bounded lean
lists, protected details, immutable revisions, correction and reasoned void.
Current facility, patient, captured ward, clinical visibility and nursing authority
govern each read/write. Read transactions recheck authority after waits. Author
identity alone grants no ward bypass. Stable actor-bound command receipts allow
exact replay and recovery after later amendments. No notification, delivery or
recipient acknowledgment is claimed; Python has no such contract.

Clinical data-class gates supplement workflow permissions. Lean clinical summary
reads require summary/full visibility; full narrative, prescribing detail and
clinical writes require full visibility. Pharmacy and laboratory context retain
their narrow purpose classes. Governed emergency access remains an audited
summary override. Chronicle publishes individual action flags, including separate
nursing authority for vitals. UI consumers fail closed, remove copied detail and
open modals on authority downgrade, and retain only permitted scalar summaries.

Scoped problem notifications capture a current authorization lease before the
write. A response from an obsolete actor/workspace cannot publish clinical text
into the new workspace. The durable interrupted-write guard recognizes the three
immutable handover commands; changed-body/UUID retries remain blocked.

## Focused evidence

- Scheduled stock: 88 repository and 31 HTTP tests passed, including stock-unit
  races, actual physical conservation, SQL paired-evidence constraints, live care
  context, session revocation and authority expiry. Independent source review
  findings were repaired before freezing.
- Patient handover: 8 repository, 8 HTTP and 72 frontend tests passed. Actual Host
  tests cover selected-admission changes, loss/reauthentication/exact retry and
  ordinary close. Metadata history does not return narrative bodies.
- Clinical visibility: 5 actual-router, 19 access and 12 existing patient tests
  passed. The prior-source regression reproduced three improper 200 responses;
  the repaired full-note/history/write and purpose-specific gates pass.
- Frontend stock, notification and visibility focused suites passed; independent
  review repaired the missing-quantity fallback and generic scalar-card modal
  disclosure. Feature lint reports zero errors; React Doctor reports zero errors
  with documented complexity/compatibility warnings, not security certification.

## Frozen acceptance

- Rust workspace: **511 passed across 93 result groups**, zero failed or ignored.
  Formatting passed. An existing invalid-item catalog test needed an explicit
  valid stock-policy fixture to continue testing its intended invalid binding;
  the focused check and full workspace passed after that correction.
- Frontend: **1,863 passed across 261 files**. Lint has zero errors and 72
  reviewed warnings. Generated-client check, Rust-V2 production build and all
  bundle budgets passed. Startup gzip is 66.07 KB (35.14 KB entry JavaScript,
  30.93 KB CSS); the largest lazy chunk is 115.05 KB, with no initial chart chunk.
- OpenAPI: byte-identical regeneration from the frozen source; 445 operations,
  2,988 resolved local references and no dangling reference.
- Native synthetic HTTP: **56 checks passed**, including explicit two-unit dose
  policy, exact physical stock deduction of two units for one supplied dose,
  actual Given evidence, immutable terminal replay, missing-policy/unit rejection,
  handover amendments/history/CAS/void and original receipt recovery after void.
  New sources were stopped and the handover voided after acceptance; real stock
  and clinical history remain. No stock was silently returned.
- All **88 migrations** succeeded; latest `202610160016`. The existing explicit
  synthetic clinician fixture remained in use; no production defaults changed.
- Warm native debug smoke: all 500 requests returned 200, five concurrent callers
  per route. Observed p99 milliseconds: identity 37.50, registry 63.61, Chronicle
  70.16, fluid summary 7.39 and medication catalog 4.08. Concurrent local tests
  were active. These figures exclude cold start, browser, edge and production
  capacity; the earlier cold staging tail remains an open limitation.
- Dependency lockfiles match the preceding recorded npm/OSV advisory inputs; no
  new dependency or fresh application-security certification is claimed.

The exact frozen source is `/tmp/hms-phase8-index-review`; the 157 indexed change
blobs are recorded in `/tmp/hms-phase8-index-tested-manifest.json`. Phase-nine
source changes are excluded. Native API SHA-256:
`94b91ec3a7f856e7536e11556df5634c9ec46cc1255171b1263b8cf30116257e`;
migrator SHA-256:
`456ebf128f72c24a65828bfd43eb7b95d27bcc803353fd02d75b7c728071aac9`.

Evidence: `/tmp/hms-phase8-index-rust-final.log`,
`/tmp/hms-phase8-index-frontend.log`, `/tmp/hms-phase8-index-lint.log`,
`/tmp/hms-phase8-index-client-check.log`, `/tmp/hms-phase8-index-build.log`,
`/tmp/hms-phase8-index-bundle.log`, `/tmp/hms-phase8-index-openapi.log`,
`/tmp/hms-phase8-http-acceptance.json`,
`/tmp/hms-phase8-native-migration-acceptance.json` and
`/tmp/hms-phase8-read-perf.json`.

## Boundaries

Broader treatment-entry regimens and repeat supply, outpatient handover, note and
template governance, admission advisory tasks, strong authentication and the
remaining parity ledger are separate work. The broader nursing/laboratory
data-class and post-wait write-authority audit continues. Production-default
clinical visibility is unchanged; explicit synthetic fixtures are not a completed
visibility-administration feature.

No new browser or live-release claim is made. Last independently verified live
source remains checkpoint three `67b9dc9dc07082ecadb3a81d26a651a476f374d8`.
GitHub Actions remains disabled; acceptance runs locally.
