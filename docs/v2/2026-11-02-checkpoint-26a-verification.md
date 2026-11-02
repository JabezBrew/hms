# Checkpoint 26A: search cache isolation and current feature policy

Updated: 2026-11-02. Finite local verification is complete. Source promotion,
commit and deployment are bound separately; this is not whole-application parity
or production/clinical acceptance.

## Resulting behavior

A one-byte query such as `a` falls back to the caller's personal recent patients.
The result-cache key now uses that same effective query before choosing whether
to include the user. The handler and repository keep the existing public query
echo, 120 Unicode-scalar cap and fewer-than-two-UTF-8-bytes fallback. The shared
normalizer is a fixed point, including whitespace exposed by truncation.
Authorized nonempty global queries can still share hydration between ordinary
users with identical result-affecting access facts.

Search uses the resolved RequestContext permissions, visibility and effective
enabled features for both the cache key and database filters. Assigned features
alone cannot select a projection that the facility's current policy disables.
Facility scope is checked before a warm result-cache lookup.

The existing live auth-version statement and full context hydration resolve the
same canonical fourteen feature booleans through the existing profile/default/
override resolver. Exact boolean equality invalidates cached facts when policy
changes. A latest timestamp alone misses deletion of a nonmaximal override and
publication from an earlier-started transaction. The old maximum remains
metadata, not authorization equality. Unknown non-null override keys retain the
existing fail-closed decoding policy. No SQL round trip or new migration is
introduced by this change. Actual query/plan/latency checks below confirm the
stated local scope.

## Evidence progression

All test fixtures are synthetic. The public regressions use actual login,
production routing, RequestContext resolution, caches and PostgreSQL projections.
Distinct ordinary readers have identical assigned access facts and distinct
personal patient contexts. Cross-instance cases use independent AppStates sharing
only the database and genuine privileged public PATCH/DELETE publications.

| Stage | Actual result and qualification |
| --- | --- |
| Unchanged production, original eight tests | 2 pass / 6 fail / 0 ignored; compilation succeeded and source/modes stayed exact. |
| Query/context repair, freshness repair deliberately withheld | 4 pass / 4 fail; personal isolation, Unicode/empty, authorized sharing and same-instance filtering pass. The earlier-timestamp publisher reaches its final stale-visibility failure after observed lock and clock/MAX assertions. |
| Corrected nonmax-delete fixture, same incomplete diagnostic implementation | 0 pass / 1 fail / 7 intentionally filtered; real DELETE, persisted override absence and unchanged MAX all succeed before the final stale-visibility failure. |
| Complete reviewed implementation | All eight public tests pass, zero failed/ignored/filtered. |
| Focused existing and added controls | Five API/cache/state tests, one complete repository search target and one exact pure normalizer test pass. These reruns must not be added to the future workspace unique count. |

The original nonmax test logged its reader in before disabling Inventory, which
warmed auth facts before its supposed cold setup. The sole fixture repair moves
reader creation after initial policy/timestamp setup and adds an explicit
post-DELETE absence assertion. The other seven tests remain exact until
formatting. The original source, failed stages and complete diffs are preserved;
the first six failures are not represented as independent proof that every later
assertion ran.

The earlier-timestamp case observes the actual public publisher waiting on the
canonical facility lock. A later database-clock anchor is written before release;
the transaction's published timestamp is earlier than the retained maximum.
No guessed sleep, cache clearing or relogin stands in for that ordering.

## Formatting and final gates

Formatting preserves all eight owned files' modes and all protected SQL/string/
character literals. The formatter command exits zero; its deliberately strict
lexical wrapper exits 90 on optional commas and pure expression-closure braces.
Root reviews those exact contexts and accepts the source separately. The failed
strict-identity receipt is retained. The subsequent formatting check passes.
No other source path changes during formatting.

The final full workspace passes **1,176 tests across 160 target summaries**, zero
failures/ignored/filtered cases, exit 0, in 4,162.72 seconds. All 3,608 candidate
source paths and modes remain exact throughout. This is one complete final-source
run; earlier focused passes are not added again. The 689 backend source files have
byte aggregate `6851693672c7fd775aca17fca246c6aca166c5226b74df2af99f9e77f3789b70`.
Subsequent reviewed documentation changes do not change those runtime bytes.

The final API, worker, migrator and exporter build passes on unchanged source.
All four actual Darwin/arm64 binaries are frozen and hash-bound. Root reexecutes
the frozen exporter and verifies exact OpenAPI
`0a787ddcc3628ccfdb2e3b3c2c0166616298ab5aa7e2734adad66f938c4879fe`,
then runs a fresh generated-client check. Client
`8e520d90fb65a1277f783d3032fd84b08e5a4552cf55d337fa686aea0d043aab`
and the public wire stay unchanged. Source annotations or unchanged client bytes
alone are not used as compiled-wire evidence.

Independent review of the actual formatted eight-file delta reports no confirmed
unresolved P0-P2 within admitted-fact and cache-isolation scope. Full workspace
and actual runtime checks below complete this finite local verification; production and broader workflow acceptance remain separate.

## Performance and limits

The one-shot six-stage native run passes in 40.218 seconds with other owned test
workloads idle. Both fresh fixtures use the same pinned actual migrator seed,
logical counts of 500 patients, 302 items and 2,378 producer documents, fourteen
enabled overrides and two ordinary readers. Physical databases, timestamps and buffer caches are
not claimed identical. The older artifact is a known-unsafe diagnostic.

| Native protected-read timing | Diagnostic 25 | Candidate 26A |
| --- | --- | --- |
| Samples / warmups / concurrency / main pool cap | 400 / 24 / 4 / 10 | 400 / 24 / 4 / 10 |
| p50 / p95 / p99 milliseconds | 2.702 / 4.266 / 23.622 | 2.862 / 4.928 / 24.085 |
| Timed errors | 0 | 0 |
| Observed DB queries / requests | 800 / 400 | 800 / 400 |
| Response payload p95 / p99 bytes | 41,045 / 41,045 | 41,045 / 41,045 |

Candidate p99 is 1.0196 times baseline, below the local 200 ms bound. Timed contexts
record 400 hits and zero hydration/result-projection queries in each variant.
Cold auth plus projection takes 4 round trips, warm 2; a new global projection
takes 3 and authorized cross-user sharing 2, unchanged between variants.

Actual one-byte HTTP checks reproduce baseline cross-user leakage and isolate
all four alternating candidate observations. Each variant records 446 status
responses, all 200, plus 22 metrics requests: 468 HTTP calls. Candidate records 1,473
check counters; baseline 1,471. These repeated counters are not unique test cases,
and baseline status 200 is not security acceptance. Genuine cross-instance
privileged publication proof belongs to the eight public-router tests, not an
invented native publisher.

Five exact production SQL statements per variant, two policy fixtures and six
executions each give 120 actual EXPLAIN executions and 40 retained first/repeated
structural plans. Plans omit expressions, query/parameter values and raw bodies.
Tiny entitlement tables can legitimately choose sequential scans; no forced
index claim is made. Search SQL literals are identical between variants, so
physical/generic/custom plan variance is not attributed to changed search SQL.

All four owned API handles and port 8106 close. Exact cleanup then removes both
registered test databases without force and preserves the 63 unrelated database
catalog entries. Original measurement/plan/source/binary evidence and private
ownership preimages remain intact.

The code has pool size/idle gauges, but its pool-wait-duration recorder has no
production callers. A wait-duration percentile is unavailable and must not be
inferred from those gauges. Local Darwin/arm64 and Docker/loopback measurements
do not establish Linux image, remote, clinical or production latency acceptance.

This slice repairs admitted request facts and result selection. It does not
retain authorization through in-flight search hydration or final response
publication. Re-enabling identical authority may select ordinary unexpired
content; immediate cross-process content freshness is not promised.

Supplier governance/seed preservation and the separate unsupported-onboarding
transport repair are outside this eight-file security delta. No complete Python/
UI parity, live deployment, clinical readiness or restoration drill is claimed.


## Supplementary dependency snapshot

The runtime-only npm audit reports zero advisories. The complete audit reports
six moderate development-chain entries rooted in the
[minimatch advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249). The installed
development-only 3.1.5 JavaScript matches the exact registry tarball/committed
integrity and lacks the described optimization preprocessing code. The audit
entries remain visible; no incompatible major override or suppression is applied.

With cargo-audit unavailable, OSV queries 337 exact registry lock versions and
returns the [rsa timing advisory](https://rustsec.org/advisories/RUSTSEC-2023-0071.html).
Its sole lock reverse edge is optional sqlx-mysql. Actual locked/offline workspace
normal/build inverse graphs print no rsa path for Linux ARM64 or Darwin ARM64. This
is configured target reachability, not an all-features/dev or exploitability
claim; the unpatched lock entry remains recorded. Source and locks stay exact.
