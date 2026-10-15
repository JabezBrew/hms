# Second parity checkpoint

Scope: complete scoped fluid reads, usable emergency access, NHIS mappings and
selected-claim batch creation, truthful inventory prices, and reset delivery and
password-change security. This checkpoint does not complete the parity ledger.

## Behavior and boundaries

- Fluid records filter by patient/admission and timestamp before paging. Server
  aggregates and daily trends cover the full authorized range; failed reads do
  not become zero balances. UTC day rollover, paging, cancellation, duplicate
  prevention and uncertain-save states are covered. Unsupported categories and
  notes are hidden rather than silently discarded. Corrections and facility
  thresholds remain a separate lifecycle slice.
- Emergency access uses current-password reauthentication, a reason/category,
  a real two-hour grant, grant status restoration, and explicit end. Actor-first
  locking enforces same-patient and three-grant limits under concurrency. The
  Chronicle startup identifies workflow versus emergency access. Remounts must
  obtain a fresh authorization result before rendering cached clinical content;
  expired/revoked access, failed status reads and uncertain end responses block
  affected content and invalidate caches. Grant status refreshes on focus and
  polls every fifteen seconds while active. Real-device credentials and browser
  emergency grants were not created unattended; contract fixtures cover them.
- NHIS mappings validate active facility references, serialize versions and
  preserve historical invoice-date snapshots. Payer-specific mapping records
  do not silently become generic claim mappings. Batch creation locks eligible
  claims, checks one currency and checked totals, prevents duplicate membership,
  and audits atomically. The UI scopes selections to the actual current page,
  preserves saved confirmation through read failure, and blocks ambiguous write
  retries. Creating a draft batch makes its member claims ready; it does not
  submit them to NHIS. File export and remittance accounting remain incomplete.
- Missing inventory prices/value display as unavailable; an explicit zero is
  retained. Shared pagination navigation cannot submit its surrounding form.
- Reset links reach the configured trusted adapter without raw-token persistence
  or logging. Webhook sends have a separate four-slot concurrency limit, account
  budget, timeout and redirect denial, and run off the request path. Disabled
  delivery issues no unreachable tokens. Dispatch is in-process rather than a
  durable queue; actual provider delivery requires configuration and sandbox
  verification. Account locking fences stale password verification; reset or
  signed-in password changes invalidate every older link and session atomically
  while preserving the previous password hash for reuse checks.

## Acceptance

- Full Rust workspace: **278 passed**, zero failed/ignored, 65 result groups.
  Tests use isolated databases in Docker Postgres. Formatting and generated
  contracts pass. Seven new reset contracts cover held webhook concurrency,
  redirect refusal, generic responses, competing links, old-link invalidation,
  password history and simultaneous signed-in changes.
- Exact staged frontend in `/tmp/hms-phase2b-index-review`: **1,355 passed in
  216 files**, lint with zero errors and 71 existing warnings, generated-client
  check and Rust-mode production build. Startup transfer is 60.77 KB gzip;
  entry JS 30.09 KB, CSS 30.69 KB, largest chunk 115.05 KB. All budgets pass.
- Changed-file React Doctor: **87/100, zero errors**, nine warnings. Remaining
  findings concern complexity, bounded collection lookups and patient-change
  state resets; they were reviewed against the independent access/cache guards.
  This is maintainability feedback, not security/accessibility certification.
- Browser testing against the exact compiled Rust checkpoint created a draft
  synthetic NHIS batch. Independent API reads confirmed one claim, the correct
  total, draft batch status and ready member claim. Mobile 390×844 had no page
  overflow. A current-admission fluid recorder saved 200 ml intake and 100 ml
  output; API reads confirmed exactly two scoped records and a complete 100 ml
  net balance. Historical visits showed history without a record-entry action.
- Independent source reviews covered access/concurrency/cache boundaries,
  fluid day/unknown-save behavior, NHIS lifecycle/date/selection guards and
  password-reset delivery/lifecycle. Reported blockers were fixed and retested.

Logs: `/tmp/hms-phase2b-workspace-acceptance.log`,
`/tmp/hms-phase2b-index-frontend-final.log`,
`/tmp/hms-phase2b-index-{lint,client,build,bundle,final-cache}.log`, and
`/tmp/hms-phase2b-password-reset-delivery-final.log`. Reviewed source/index
fingerprints were saved before concurrent phase-three work resumed. No staging
deployment of this checkpoint is claimed by these local checks.
