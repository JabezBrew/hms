# Checkpoint 25: governed inventory categories

Updated: 2026-11-02. Finite local verification, including the scoped automated
browser run and review of its ten screenshots. Final source promotion, commit
and release decisions remain separate. This is not complete Python/UI parity,
a deployment, clinical readiness or production latency acceptance.

## Verified workflow

The [category contract](2026-11-02-inventory-category-governance-scope.md)
defines the implemented slice: create, current metadata/nullable description,
explicit direct-parent correction, unused retirement/reactivation, bounded
current directory/history and original-actor UUID recovery. Permanent identity,
current retained references, exact parent revisions and complete bounded ancestry
are enforced. No item or child is moved by category metadata changes.

Ordinary reads retain current facility/profile/user/session/network, effective
Inventory feature and exact view/demographics proof through result construction
and the final database clock. Ordinary onsite viewers need neither management
nor fresh credential confirmation. Commands and own receipts retain their
separate management/current-credential gates. Directory/history remain exactly
eight/nine scalar fields without descriptions, reasons or actor observations;
exact detail and authorized own receipts have positive richer-data controls.

Migration 031 preserves original category values and unknown provenance, requires
exact schema/default/guard evidence, and repairs producer-backed foreign category
search text and metadata with both optional rebuild toggles off. Canonical MED
provisioning is missing-only; conflicting identity or a retired source cannot
silently publish default items.

## Bound components and local checks

The immutable component manifests bind bytes and modes; subsequent documentation
changes do not change these runtime component identities.

| Component | Bound identity |
| --- | --- |
| Rust backend, 688 files | `f2300776a6f9dc21fa4b0296951b48f5bef2fc1cb34e9c79d1bc46b433437bb5` |
| Frontend, 1,756 source paths | `89210abcb49d748b7ccd244a8885efb3185b7aa191fd52ff0db111f7d9ba5db0` |
| Frontend, 396 dist files | `dab048c85f7f7c3d6682747855a3bff641976cb274277ab9fadadd129ed18c3a` |
| Actual compiled OpenAPI | `0a787ddcc3628ccfdb2e3b3c2c0166616298ab5aa7e2734adad66f938c4879fe` |
| Generated operation client | `8e520d90fb65a1277f783d3032fd84b08e5a4552cf55d337fa686aea0d043aab` |

The operation-only client does not encode DTO schemas. Compiled OpenAPI,
strict-input/API tests and actual response checks establish those wire shapes;
unchanged client bytes alone are insufficient. All four API/exporter/worker/
migrator binaries were rebuilt, frozen and hash-bound. The frozen exporter
reproduced the exact OpenAPI bytes.

| Check | Recorded result |
| --- | --- |
| Rust | Honest composite: 1,166 unique passing tests across 159 target summaries, zero unresolved failures/ignored cases; formatting and four-binary build pass. |
| Frontend | 3,722 tests in 383 files, zero failures, one worker; all six gate groups pass, including lint, build, API generation, bundle budgets and native quality. |
| Operations | Final v3: 573 passes, zero skips; actual isolated Caddy HTTP included. The tested 3,606-file candidate map remained unchanged during that run. |
| Native synthetic slice | 899 assertion counters, not unique tests; 635 recorded HTTP calls: 209 functional/diagnostic and 426 timing. |
| Browser slice | 77 checks, four actual business POSTs and four persisted commands/audits; ten PNGs reviewed by root and independently for the stated visual scope. |

The frontend quality comparison retains existing-path score 100 and new/combined
score 92, zero errors and four maintainability warnings. React Doctor is
maintainability feedback, not security or accessibility certification. Startup
gzip is 67.65 KB within 90 KB; no chart chunk enters the initial graph. Three
focus-related frontend files changed after earlier results; eight actual Radix
focus regressions and the complete final gate set cover that delta.

The Rust workspace command itself finished with 1,165 passes and one stale CLI
expectation failure, exit101. Its current-schema assertion expected 030 although
the actual migrated schema correctly reported 031. Only that test literal changed;
all other source bytes/modes remained exact. The entire affected 11-case CLI
target passed afterward. Composite counting replaces its old 10 passes plus one
failure with 11 passes: **1,165 − 10 + 11 = 1,166**, without overlapping counts.
This is not a clean uninterrupted full-workspace rerun on the final test source.
Original failed/partial runs, the exact preimage/delta and corrected-target
receipt remain preserved. Final formatting/build/exporter checks bind the final
source separately.

An earlier native harness incorrectly expected demo reseeding to succeed after
immutable clinical evidence existed. Its failure evidence remains preserved;
its six owned databases were subsequently removed by exact cleanup after browser
closure. A separately reviewed attempt corrected only the harness expectation;
the protective production guard was retained. The earlier ops v2 fixture-mode
failure is also preserved: its child inherited umask 077; final v3 used the
fixtures' expected 022 while keeping private artifacts 077. Neither correction is
presented as a product-logic fix.

## Native persistence, clocks and bounded timing

Fresh isolated Docker-hosted databases exercise actual029/030 historical
fixtures,031 initialization/upgrade, compiled schema probes, global canonical-ID
contention, intrinsic guards and generated-client HTTP. Accepted business
workflows execute with required guards active. Separate owned schema-fault
probes deliberately tamper with required schema evidence and restore the exact
schema before subsequent accepted workflow checks. Read/revocation ordering and final-clock expiry after measured waits have
separate actual backend contracts; sequential native denials are not relabeled
as those concurrency proofs.

Final persistence binds 96 category commands, 96 audits and 96 exact original
receipts, including three noops, plus one nonempty original ITEM receipt whose
category observation survives later metadata changes. Ordinary actors retain
exact permissions/features/visibility without admin, passkey or membership
escalation. Eight actual signed-token signature checks and two same-session
publication witnesses cover the ordinary clock protocol.

Fresh demo seeding succeeds. Repeating it returns exactly the protective
`demo_seed_existing_clinical_evidence` error, with nonzero exit and empty stdout.
Across refusal and separate successful baseline-only replay,50 patients,
84 patient-linked/FK-descendant relations, 246 note versions and 8 placements
retain exact row hashes/counts, including facility audit evidence. Performance
seeding has 500 patients and replays its one exact original configuration receipt
without rewriting that receipt or the clinical graph. Supplier-row changes
remain separately recorded; supplier preservation is not claimed.

With other test runtimes idle, 24 warmups precede400 bounded protected reads at
concurrency 4/pool 10: p50=4.537ms, p95=5.809ms, p99=37.431ms, zero measured or
warmup errors. These are Darwin/arm64 native binaries with loopback HTTP and
local Docker Postgres/Redis. They do not establish Linux ARM64 image acceptance,
remote performance or a clinical latency guarantee.

The actual old 030 runtime became ready on 031; its probe reported its known 030
epoch. Finite old-client diagnostics preserved the selected business digest.
No future-schema startup refusal is inferred and no supported rollback is
claimed. Supported deployment compatibility remains governed by the explicit
breaking-epoch fence. Attempt2 databases were retained through browser review.
After browser closure, exact cleanup removed all 12 owned databases across both
attempts; the 63 unrelated database inventory entries remained unchanged.
Evidence and pins were preserved, and owned listeners closed.

## Browser and visual scope

The approved macOS browser guard launches the project's matched browser with a
separate ordinary actor and isolated context. Four viewports cover 1440×900,
1280×720, 390×844 and 366×844. Actual login, directory/parent paging, review/cancel,
focus restoration, create/correct/retire/reactivate and recording history/reload
pass. Correction reaches the real API and commits once; its reply is deliberately
lost. Recovery uses the original receipt GET, with no second business POST.

The browser preserves selected original inventory/business rows and native
identity/grant/session/factor snapshot families. The new browser identity has
its own expected authentication effects. Context/browser/API/preview closure
passes, with no blocked external request or page error. Original source/dist
hashes remain exact except the isolated preview's declared runtime configuration.
Ten screenshots have scoped root and independent frontend visual review with
no blocker. Native horizontal mobile-table overflow is supported by CSS;
activation of an offscreen table action was not directly exercised. This does
not establish dark mode, other browser engines, screen-reader certification or
whole-application rendered acceptance.

The coarse browser census records two other-API 500s; private preview diagnostics
also contain exactly two sanitized proxy-upstream failure markers. Endpoints were
not recorded, so route attribution remains a separate follow-up and a link to
legacy onboarding is unproven. Raw receipts are retained. One care-area work
read's 403 is an expected ordinary-permission denial. The 77-check category slice
is not an error-free whole-application HTTP claim.

## Remaining work and release boundary

- **26A:** source-confirmed Omni search personal-recent cache isolation,
  effective-feature key/filter consistency and cross-instance entitlement
  admission freshness. Proposed regressions/fixes are staged; actual unchanged-
  production red/green execution and final base/commit binding remain required.
  This also does not claim retained in-flight search publication authority.
- **26B:** the baseline supplier-row UPSERT still rewrites retained rows.
  Missing-only item-to-supplier link initialization is a different behavior.
  Only supplier rows were excluded from provisioning preservation, with explicit
  before/after diagnostics; general business conservation includes suppliers.
- **26C:** source review found an unguarded legacy onboarding startup GET
  selected through inferred doctor access from demographics permission, with
  one retry. Rust-mode startup transport guarding is queued. The exact routes
  behind the two coarse browser 500 counts were not captured, so that observed
  count is not attributed to this source-confirmed gap.
- A local category rename may leave an older category label in general item
  search until the existing explicit rebuild/cache turnover. Category
  administration observes current metadata. No synchronous rename fanout was
  added.
- The wider [parity ledger](2026-10-15-parity-ledger.md), auxiliary API 500 route
  attribution, deployment/backup/rollback drills and environment-specific
  security/performance acceptance remain separate.

Review artifacts and negative controls remain immutable. This note records
bounded local evidence; root owns final source review, promotion and commit.
