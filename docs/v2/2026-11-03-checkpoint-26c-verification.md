# Checkpoint 26C: optional onboarding transport at Rust startup

Updated: 2026-11-03. The finite local frontend and authenticated browser checks
pass. Commit/push identity is recorded separately. This repairs optional startup
transport; it does not implement a Rust guided-onboarding producer or establish
whole-application, deployment or clinical acceptance.

## Resulting behavior

Rust V2 has no guided-onboarding route in its compiled OpenAPI. All five optional
onboarding API methods now reject unsupported Rust transport before fetching a
legacy endpoint. Both read helpers pass the original AbortSignal and preserve
AbortError. Supported legacy transport keeps its existing behavior.

The runtime derives availability from the current transport, authenticated user
and supported role. On becoming unavailable, it detaches the old query observer,
cancels consumed signals and masks retained flow/progress data. Held navigation,
skip and event callbacks recheck transport before acting. Already dispatched
legacy mutations are not canceled or replayed. Broader legacy actor/facility
cache isolation remains separate work.

Only five feature files change: the API, runtime hook, feature README and two
regression files. No backend, wire, dependency, global theme or UI primitive is
changed by this checkpoint.

## Local frontend verification

The same 22 focused tests first produce 13 failures with nine passing legacy
controls, then all pass with the repair. They exercise the actual startup
component, Router, QueryClient and synthetic fetch transport rather than mocking
availability. Coverage includes retained legacy cache, late flow/progress
responses, stale action callbacks, logout/unmount, cancellation and supported
legacy start/navigation/skip behavior.

The full final frontend run passes **3,744 tests in 385 files**, zero failures,
using one worker and a 2 GiB Node heap. Six gate groups/ten serial commands pass,
including lint, build, generated-client and native React-quality/bundle checks.
Matched existing paths, added tests and their combined Doctor scan score 100 with
zero errors/warnings. Startup gzip 67.64 kB is within 90 kB; entry JS gzip 36.52 kB
is within 40 kB. These are measured build budgets, not browser latency claims.

All 1,758 source files and 396 final dist assets stay unchanged through subsequent
browser verification. The candidate was built with checkpoint25 metadata
`81381dd8c8344830cf6b9329f8db76cc216dc8ad`. Root separately verifies that accepted
26A changes no frontend runtime or generated-client bytes, and binds the actual
689-file accepted backend and four frozen Darwin/arm64 binaries. This is local
integration provenance; the original build is not relabeled as a new production
release. The compiled OpenAPI and generated client remain byte-identical to 26A.

## Actual authenticated startup and reload

The successful one-shot browser run passes **66 assertions**, with a separate
**40-assertion** real auth setup. These counters are not added to the frontend
unit-test total. A fresh registered Docker PostgreSQL database applies 103
migrations through epoch 031. The frozen migrator configures only its synthetic
loopback network policy through the real versioned operator command before the
original conservation snapshot. The ordinary user has exactly four grants,
Inventory and demographics visibility, with no passkey or manufactured factor
assurance. Real initial login, mandatory password change and genuine same-session
password confirmation precede the browser's independent public login.

Before each full document, the browser observes the real path-correct refresh
cookies and matches the outgoing cookie pair and CSRF header. A real200 refresh
must preserve the original actor/facility/profile/revision facts and issue a new
session ID. After the quiet interval, the actual Refresh categories control must
produce a protected200 GET using all six exact current successor-scope claims.
This follows legitimate refresh rotation; it does not permit an arbitrary new
session or claim the original login session ID remains fixed.

Both documents observe the exact deferred OnboardingRuntime resource and the
application's native root service worker active and controlling the document.
Seven named browser facts are awaited under a monotonic30-second host deadline.
The observed readiness waits are 8,235 ms and 2 ms, followed by real quiet windows.
No worker registration, controller injection or virtual-clock advance is supplied
by the harness. Resource delivery, including possible native cache delivery, is
not universal module-execution proof or proof of an individual cache hit; actual
component/cache/stale-callback execution remains covered by the unit tests.

Legacy onboarding attempts, unrelated business writes, external requests,
uncaught page errors, unexpected document navigation and scoped auth denials are
all zero in this bounded observation. Finite listed business/original-actor table
hashes and unrelated database catalogue facts remain unchanged. Own real auth
effects are expected. This is not a whole-database audit or a whole-app health
claim, and it does not attribute the two earlier coarse browser API 500 counts.

## Preserved diagnostics and cleanup

Four failed runtime attempts remain preserved: an invalid IP-address WebAuthn RP
configuration; a harness comparison against the pre-refresh session ID; a check
before the application's 12-second worker registration timer; and an async
Playwright wait predicate whose Promise was treated as truthy. A clean isolated
probe on the installed Playwright 1.58.2 reproduces synchronous-false timeout and
an async-false handle returned immediately. The final harness explicitly awaits
serialized readiness facts and validates their values and deadline. No product
source or unit test is changed during these harness repairs; failed commands are
not relabeled as passing runs.

The successful final command exits zero, independently closes its browser,
context, API and preview, and verifies source/artifact/identity/conservation
again after closure. Root later rechecks those proofs and removes only its exact
registered name/OID/owner database. All five owned attempt databases are now
absent, and 63 unrelated catalogue entries are unchanged. All source, original
ownership records, failed evidence, accepted artifacts and other applications
are preserved.

## Evidence and remaining scope

Private body-free receipts are under `results/phase26c-recovery.local/`:

- `gates-v1/final-receipt.json`: complete frontend gates.
- `root-integration-v1/integration-acceptance-v1.json`: accepted 26A source/wire
  and original build-metadata qualification.
- `browser-runtime-v1/attempt-v5/acceptance.json`: successful actual browser run.
- `browser-runtime-v1/independent-review-v2/awaited-native-sw-v8-review-v1.json`:
  independent final harness review.
- `root-integration-v1/successful-attempt5-closeout/`: root acceptance and exact
  cleanup, with all source/artifact paths reverified.

Rust guided onboarding, full supplier 26B acceptance, wider Python/UI parity,
physical authenticator checks, remote deployment and production readiness remain
separate. Future deployment needs a new exact-commit production build; this
checkpoint publishes reviewed source, not the older metadata-bearing dist.
