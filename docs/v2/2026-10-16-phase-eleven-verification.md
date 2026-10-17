# Admission follow-up and session-bound passkey ceremonies

Status: frozen local acceptance passed. Browser/staging acceptance remains pending
previous approval requests. Full Python parity is not claimed.

Admission follow-up is a real case checklist with eight supported nonblocking
types. Explicit creation and terminal decisions persist original clinical notes,
creation phase/ward and actor snapshots, immutable reasoned outcomes, parent
context tokens, version checks and UUID command receipts. Completion notes are
optional; unresolved acknowledgment and manual cancellation require a reason.
Acknowledged unresolved is never labelled Completed. A type cannot reopen or be
quietly recreated after a terminal decision.

The rich workflow requires explicit Full visibility, ordinary clinical
relationship, Admissions/Patients/Encounters entitlement, admission permission,
current ward authority and live session/profile/deadline proof across waits.
There is no creator/attending/role bypass, new default grant, emergency write
elevation or fabricated relationship created by intake. Ready cases are reached
through a bounded actual patient-case picker, not an inferred active admission.

Canonical case cancellation and discharge retire only Pending follow-up with
actual actor/time and a controlled system source/reason code in the same
transaction. Prior clinical terminal outcomes remain unchanged. Operational
closure rights retain their existing lean demographic scope; they do not expose
follow-up notes or grant clinical access. Strict bodyless closure commands reject
unsupported content. Separate activation/intake/discharge blockers remain
authoritative; these advisories cannot clear them or block discharge. Existing
discharge blocker preflight concurrency is a separate documented boundary.

The shadcn Chronicle panel uses exact case context, fresh protected detail,
separate lean headers, original receipts and strict copied-evidence comparison.
Unknown writes retain the same reviewed UUID/body without automatic retries.
Case/principal changes and protected denial remove copied clinical content;
ordinary close retains the appropriate request controller. Lean eligibility or
case-list reads do not count as rich uncertainty-review evidence. The standalone
case page hands off to Chronicle rather than displaying clinical notes there.

The existing WebAuthn enrollment/assertion-test endpoints now bind ceremonies
to the exact initiating session and authority versions, recheck actual database
clock after waits and after audit, and atomically persist credential changes,
challenge consumption and minimal audit. Matching invalid crypto consumes only
its own challenge; wrong session/purpose cannot burn the rightful ceremony.
Runtime-generated ES256 software authenticator tests exercise actual signed
WebAuthn HTTP requests. This does not enforce MFA login or establish fresh
privileged proof; password login and existing privilege policy remain unchanged.

## Focused evidence before snapshot

- Advisory backend: ten repository tests, including both orders of clinical
  decision vs case closure, source-token changes without timestamp bumps, current
  ward predicates before LIMIT and canonical feature-writer ordering.
- Advisory HTTP: seven scenarios pass, including direct rich read/create and
  operational cancel after real source-lock waits followed by session revocation.
- Advisory frontend: 123 focused/affected checks in twelve suites; independent
  52-check rerun passed. React Doctor
  scanned 23 production files: zero errors, four warnings; one new workspace
  complexity warning and three preserved shared-page warnings.
- Auth: 14 genuine cryptographic HTTP tests and all 25 existing auth contracts
  pass. Both originally failing session/expiry probes now pass; migration,
  one-time consumption, live revocation and audit rollback are covered.
- A proposed three-transaction deadlock was not reproduced in the independent
  PostgreSQL probe. The list proof-order repair is supported by a real repository
  test of source-wait/feature-publication behavior, not a claimed 40P01 fix.

## Remaining work

No role inbox delivery or advisory assignment contract is implemented here.
Governed clinical-care assignment administration remains absent; fixture-only
relationship setup is not a public feature. Genuine MFA login/recovery/step-up,
credential management limits, pending-ceremony bounds and cleanup are later work.
Other parity ledger workflows remain incomplete. No new browser, physical
authenticator or live-deployment claim is made.

## Frozen local acceptance

- Frontend full suite: **2,106 tests in 282 files passed**. Lint has zero errors
  and 72 existing warnings; generated-client/build checks pass. Bundle budgets
  pass: startup 66.51 KB gzip, entry 35.53 KB, CSS 30.98 KB, largest lazy 115.05 KB,
  no initial chart chunk.
- OpenAPI: 462 operations and 3,180 resolved local references, including all four
  actual case-list query parameters. Frozen binary generation is byte-identical.
- Native synthetic API: **77 checks passed**, all 93 migrations successful, latest
  `202610160021`. Ordinary relationship setup is fixture-only, not an assignment
  feature. No native credential was enrolled/disabled and no account was elevated
  by this checkpoint. Seeding/search rebuild stayed disabled.
- Native API SHA256 `ea0144987898449520503f7196b0117e778ebe709727b81facb02529944b17ca`;
  migrator SHA256 `e4ed0d4d01f7ded7672a88608c52c560148142a15084b70d299c256118325b01`.
- Warm local debug sample: 700/700 HTTP 200, 100 per route, five concurrent callers.
  p99 ms: advisory context 142.71, advisory picker 43.00, identity 1.68, registry 3.72,
  Chronicle 11.93, fluid summary 11.27, medication catalog 2.99. Excludes cold
  origin, edge/browser and production capacity; staging cold-start limitation
  remains unresolved.
- First full Rust run stopped on the old ward journey's expected generic
  `discharge_complete_failed` code. The protected command correctly returned
  409 `discharge_blockers_open`. The assertion now expects the specific contract;
  the new admission HTTP scenario explicitly verifies open blockers deny closure
  without advisory/command effects before its deliberate fixture overrides.
  The final full Rust run passed **617 tests in 103 groups**, zero failed or
  ignored. A separate scoped-revocation fixture now derives its already-active
  start from PostgreSQL rather than the host clock. Its isolated rerun passed;
  a persistent clock probe measured a submillisecond host/database difference.
  Scope, revocation and future-grant assertions remain in place.
