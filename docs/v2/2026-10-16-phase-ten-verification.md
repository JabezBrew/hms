# Atomic ward rounds and fluid authority lifetime

Status: frozen local acceptance and focused independent reviews passed. Browser and staging checks remain pending the previously
requested approvals. Full Python parity is not claimed.

Ward rounds now save one complete explicitly reviewed draft with a parent version
check and immutable command receipt. Separate commit revalidates selected
patient/admission, live authority, source medication snapshots and active lab
selections under locks, then creates actual prescription, laboratory, nursing or
normal discharge-request artifacts atomically. No separate clinical-note record
is invented. Unsafe legacy mutation routes return an explicit conflict.

Legacy read paths are bounded and bind child/artifact scope to the parent.
Imported inconsistent or partially committed drafts require review before any
replacement. Actual race checks cover canonical supply, medication decisions and
discharge producers, preserving stock and clinical evidence. Original receipts
retain the original outcome; current access still governs recovery.

The Rust Chronicle workspace uses the selected admission, fresh protected reads,
explicit Save and Complete review, named source targets, exact receipt validation
and retained interrupted-write recovery. Every completed action must map to its
actual corresponding artifact. Cached clinical text is not mounted before the
new protected read. Temporary failures hide the DOM while retaining the draft;
denial and scope changes clear copied content. The compatibility drawer hands
off into this workspace. Cancelled old actions remain historical evidence.

Fluid observations, detailed lists, categories, assessment and mutations now
require Full clinical visibility, Nursing entitlement and current ward/session
authority across waits. Scalar totals/trends keep their explicit Summary scope.
The new minimal eligibility context does not expose rich observations and cannot
count as manual recovery evidence for an uncertain clinical write. UI entry uses
the actual selected admission and fresh eligibility, with historical correction
kept distinct from new active-admission entry.

## Focused evidence

- Ward round: 15 repository and 9 actual HTTP tests; independent backend review
  clear, including legacy scope and read bounds.
- Fluid authority: 12 repository and 12 actual HTTP checks; independent source
  review clear.
- Fluid UI: 133 new/affected checks and independent 49-check rerun.
- Ward-round UI: 40 focused checks across six suites. Independent 33-check
  rerun preceded three final additional regressions. Actual client/guard tests
  cover UUID/body recovery, scope changes, cached denial and artifact mapping.
- React Doctor: ward-round scan of ten production files has zero errors and two
  new complexity warnings in the editor/workspace coordinator. Fluid scan has
  zero errors and six documented maintainability warnings. These are diagnostic
  results, not security or accessibility certification.

## Boundaries

No browser-render acceptance or deployment is claimed for this checkpoint.
Last independently verified live source remains checkpoint three
`67b9dc9dc07082ecadb3a81d26a651a476f374d8`; later checkpoints are pushed only.
Admission advisories, genuine second-factor login/fresh privilege proof, ward
transfer and the rest of the parity ledger remain later work. GitHub Actions
stays disabled; acceptance runs locally.

Detailed contracts: `2026-10-16-ward-round-command-scope.md`,
`2026-10-16-fluid-access-lifetime-scope.md`,
`2026-10-16-fluid-workspace-context.md`.

## Frozen acceptance

- Exact index snapshot: 80 reviewed paths. Next-phase authentication fixtures
  and concurrent admission/authentication work were excluded. Owner manifests
  matched; only the reviewed ward-round branch changed the shared registry.
- Rust workspace: **586 tests passed across 100 result groups**, zero failed or
  ignored. Formatting passed.
- Frontend: **2,052 tests in 277 files passed** with two workers. Lint has zero
  errors and 72 existing warnings. Generated-client and production build checks
  passed.
- OpenAPI: **456 operations and 3,106 resolved local references**. Frozen binary
  generation is byte-identical to the reviewed contract.
- Bundle budgets pass: startup 66.28 KB gzip, entry 35.31 KB, CSS 30.97 KB,
  largest lazy chunk 115.05 KB. No initial chart chunk.
- Native synthetic HTTP acceptance: **65 checks passed**, including real task
  and prescription artifacts, original immutable draft/commit recovery, exact
  version conflicts, fluid correction/void/history and anonymous denial.
  The pre-existing native draft was preserved and explicitly checked unchanged.
  Ward-round commands used a separate synthetic patient/admission with explicit
  fixture-only relationship setup; this is not a public assignment feature.
  Early harness assumptions were corrected to the inspected contract: scope
  mismatch is 400 for fluid and 409 for ward rounds, empty workspaces cannot
  commit, the compatibility current read remains optional-scope, and timestamps
  serialize canonically in UTC. No product guard was weakened.
- All **91 migrations** succeeded, latest `202610160019`. Seeding and search
  rebuild were disabled; retained clinical evidence was not reset. Native API
  SHA256 `11837b21cbd09a2054cd41933bd9dfef2f281195d72bc6192fb7f5efd9331fdb`;
  migrator SHA256 `c26730dedb2bf2657d552bcc04c33af06abd09712143145f69b6f74c3869d269`.
- Warm native debug read sample: **700/700 HTTP 200**, 100 requests per route,
  five concurrent callers. p99 ms: ward-round context 145.12, fluid context 9.30,
  identity 1.87, registry 3.19, Chronicle 10.70, fluid summary 9.87 and medication
  catalog 3.80. Excludes cold start, edge, browser and production capacity; the
  earlier staging cold-origin p99 limitation remains unresolved.

Local evidence is retained in `/tmp/hms-phase10-index-{rust,frontend,lint,fmt,
client-check,build,bundle}.log`, `/tmp/hms-phase10-http-acceptance.json`,
`/tmp/hms-phase10-native-migration-acceptance.json` and
`/tmp/hms-phase10-read-perf.json`.
