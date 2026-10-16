# Trusted network policy and interrupted-write recovery

Status: local regression and native HTTP acceptance passed. Browser rendering and staging deployment
remain pending explicit approvals. This checkpoint does not establish full
Python parity, strong MFA login, or production clinical approval.

## Behavior and boundaries

Rust derives client provenance from the actual socket peer and, only for an
explicitly trusted proxy, one fully parsed bounded forwarding chain. Caller
location assertions cannot grant onsite authority. Unconfigured facilities and
unknown connections cannot write. Configured deny also refuses workflow reads
from unknown connections. Facility policy publication requires fresh authority,
actual-connection retention, current server-authorized policy version and client
CAS under lock. Immutable command receipts preserve deliberate exact replay.
The separate operator command provides explicit bootstrap/recovery without a
fabricated user or implicit onsite ranges. See the trusted-network scope record.

The settings UI supports credential confirmation, canonical preview, review and
publication. Clinical routes wait for current policy evidence. Denied or failed
checks hide clinical DOM; credential deadlines restrict the decision immediately.
Refresh and definitive-401 retries retain the original principal and authority
scope. Backend enforcement remains authoritative.

A bounded tab-session ledger preserves opaque uncertainty markers when dispatched
writes lose responses, abort, or fail typed confirmation. It retains salted hashes
and operation categories, never clinical bodies, raw identifiers, URLs, credentials
or tokens. New writes are blocked across remount/reauthentication/reload. Only an
explicit exact request with a supported server UUID can retry automatically through
the guard; forms do not recreate uncertain writes with new UUIDs. Background RUM
is excluded from uncertainty tracking while remaining subject to network policy.

Recovery is explicitly manual. Fresh related reads enable a separate user
acknowledgment; this is not proof of a saved/absent write or complete history.
Admission/patient/path targets require their specific opaque resource match.
Facility collection creates without a known canonical target may use a fresh
related collection in the same authority scope. Storage failure/corruption/full
unresolved capacity fails closed for new writes, while permitted reads continue.
Typed adapters cover network, fluid/rules, appointment groups, standing requests,
PRN, prescribing/MAR, pharmacy supply, NHIS, access revocation, catalog correction
and emergency grant create/end. This is not universal legacy DTO validation.

The Compose proxy packet isolates the API/Caddy and tunnel/Caddy links. Only
explicit static proxy peers are trusted; API addresses are reserved against DHCP
collision. Real Caddy error logs remove request objects. Vite proxy diagnostics
retain connectivity errors without raw URLs, headers, stacks or request details.
Generic deployment defaults retain empty trusted proxies.

## Accepted local evidence

- Frozen backend snapshot `/tmp/hms-phase6-index-review`: **424 Rust tests passed**
  in 84 result groups, zero failed or ignored, using isolated Docker Postgres
  databases. Native API/migrator compilation and byte-identical OpenAPI
  roundtrip pass.
- The independent adversarial pass reproduced a waiting admin publication that
  guessed the next CAS version and overwrote a concurrent operator Deny policy.
  The regression failed with HTTP200 before the fix and now returns HTTP409.
  A server-derived resolved-policy-version fence is checked under the policy
  lock after the immutable exact-replay branch. No extra hot-path query was added.
- Native API plus the actual operator binary: **40 checks passed**. Covered true
  unconfigured policy, onsite/offsite/unknown enforcement, all malformed-header
  cases, exact read-POST exceptions, denied identity-lookup writes, Deny reads,
  fresh-credential writes and unknown refusal. An original bootstrap replay
  returned its immutable version1 while current policy stayed at version3.
  Explicit local direct-peer policy was then restored as version4 and the API
  restarted with trusted proxies empty. Only unchanged synthetic account display
  data was written; no clinical record was mutated by this harness.
- Operations tests: **100 passed**. The actual isolated Caddy HTTP chain and
  error-log privacy suite passed **16 checks**. Installed Vite real proxy-failure
  and diagnostic variants passed **2 tests**. Native Caddy adapters validate all
  active gateway configurations.
- Warm local native debug read smoke: **500/500 returned HTTP200**, five concurrent
  readers, 100 requests per route. p99 milliseconds: identity77.95, registry108.62,
  Chronicle73.50, scoped fluid summary23.26, medication catalog12.23. This excludes
  browser/edge/cold start and is not capacity or production latency proof.

- Frozen frontend: **1,646 tests passed in 247 files**. ESLint has zero errors
  and 72 warnings. Generated-client check, Rust-mode production build and bundle
  budgets pass: startup65.87 KB gzip, entry JS34.95 KB, CSS30.92 KB, largest lazy
  chunk115.05 KB gzip, no initial chart chunk. Changed-source React Doctor reports
  score92, zero errors. The feature owner separately reviewed four maintainability
  warnings (component complexity, intentional expiry refetch, existing transition).
- Independent real fluid-panel/boundary regressions cover response loss followed
  by credential expiry, hidden clinical DOM, same-actor remount write blocking,
  malformed success, dispatched abort and another actor's isolated ledger.
  Typed adapter regressions exercise real HTTP409 prescription/NHIS ambiguity
  metadata, reload persistence, catalog wrong-item/malformed confirmation and
  emergency grant/end receipt validation. The first full run caught an overly
  strict catalog echo-equality check; the corrected validator accepts persisted
  server values for the requested item. All final tests above use that correction.
- Final frontend source is frozen independently of ongoing prescription and
  scoped nursing work. Index/source fingerprint checks ensure the release only
  contains the accepted checkpoint. Backend and frontend native gates do not
  substitute for the blocked rendered-browser and live-release checks.

## Release boundary

Automatic approval review previously rejected navigation to local preview
`http://127.0.0.1:4179`, requiring user confirmation, and the source upload to
existing synthetic staging because destination ownership was not established by
trusted user content. Both confirmations remain pending. No alternate browser
surface, port or indirect upload is used. Live remains checkpoint3 commit
`67b9dc9dc07082ecadb3a81d26a651a476f374d8` until a later verified deployment.
The older cold-origin tail observation remains an open performance limitation.

Evidence: `/tmp/hms-phase6-index-rust-final.log`,
`/tmp/hms-phase6-index-native.log`, `/tmp/hms-phase6-oas-roundtrip.log`,
`/tmp/hms-phase6-native-network-acceptance.json`,
`/tmp/hms-phase6-index-{frontend,lint,build,bundle}-final.log`,
`/tmp/hms-phase6-index-client-check.log`, `/tmp/hms-network-parent-doctor.log`, `/tmp/hms-phase6-read-perf.json`,
`/tmp/hms-network-all-ops-final.log`, `/tmp/hms-network-proxy-tests.log`,
`/tmp/hms-network-policy-version-{red,db-green,http-green,cli-green}.log`.
