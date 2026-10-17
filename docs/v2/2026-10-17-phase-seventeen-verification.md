# Seventeenth checkpoint: governed referral responses

Status: frozen full backend, frontend, generated contract, local ops and native
synthetic acceptance passed. Complete Python/UI parity, consultation encounters,
rendered browser acceptance and a live release remain separate.

Inbox and sent referrals hand the exact referral and patient to a lazy Patient
Chronicle workspace. Draft save, explicit completion and a reasoned terminal
amendment are separate reviewed UUID commands. Saving a draft preserves routing
status and completion time. Completing Accepted or Scheduled changes status and
records completion once; later amendments preserve that original time. Metadata
history is cursor-paginated, with explicit exact-version reads and immutable
actor-bound original receipts. Imported content is observed without inventing an
original author or recording time.

The new response purpose requires current facility, session, profile, network,
Patients/Referrals features, ReferralManage, Full clinical and demographic
authority. Ordinary relationship comes from current patient context, an actual
same-facility authored clinical note, or the selected referral's creating or
accepting actor. Role names and service membership grant no implicit access.
Historical response access does not invent living/current-encounter restrictions.
Reads and writes retain proof through actual waits and final database time. An
existing note-management permission is not required for referral response work.

Routing list/detail/SLA DTOs redact specialist notes and recommendations. Cached
legacy rich values are also hidden in the Rust UI. The old completion endpoint
returns a typed409 requiring reviewed response work; old Rust start-consultation
and response-update shortcuts refuse without dispatch. Django compatibility is
retained. The consultation encounter engine remains unimplemented by this slice.

Scheduling now locks the referral before protected authority and capacity work,
then records the appointment, manual history, audit and routing update in one
transaction. Current Appointments and AppointmentManage authority remains held
through booking. Default-clinic lookup uses that transaction, including with a
one-connection pool. Local active clinic/service/practitioner/session and existing
capacity/overbook rules remain authoritative. Definite booking rejection differs
from an unknown commit; raw database errors are never returned to the UI.

Migration024 adds immutable response revisions and command receipts, scoped
deferred receipt/root consistency guards, monotonic root identity/version and
explicit legacy-import observation. A command cannot point to another referral's
result or carry an incomplete or inconsistent receipt. Replay defensively checks
the full typed immutable evidence. This database integrity finding is not claimed
as an unprivileged HTTP exploit.

The retained workspace separates editing, review and dispatch. Normal close
retains a mounted draft; patient/referral/authority changes and current403 discard
protected copies. Changing away and back cannot restore old review consent.
Unconfirmed writes retain the original UUID, intent and opaque shared barrier.
Exact receipt/retry recovery does not silently apply later source changes.

If a remount loses the original RAM request, a separate manual saved-state review
uses actual fresh protected transport reads and a separate fresh acknowledgment.
It explicitly does not identify the earlier request's outcome. Proofs are
single-use and bound to the barrier, source, transport and current authority;
context changes and later403 invalidate them, including during an active retry.
No clinical body, raw identifier, credential or source token enters the persisted
opaque marker. Other command families keep their existing review rules.

## Runtime and recovery boundary

Migration202610170024 is a breaking runtime epoch because earlier runtimes bypass
the new response-content policy. Both the declaration and required minimum are
024. The actual compatibility probe checks committed migration checksums, success
and required layout/enabled guards. API and worker perform a bounded once-per-
process gate before provisioning, listening or readiness. Cheap health requests
do not repeatedly take the migration lock. Missing, failed, contradictory or old
schema refuses startup. An old023 runtime cannot be automatically restored after
024; use a reviewed compatible forward artifact or separately reviewed database
restoration. Existing host lease, drain and recovery-anchor protocols remain.

## Verification

| Check | Result |
| --- | --- |
| Focused response/scheduling backend | 42 pass: 21 HTTP and 21 database cases |
| Actual schema/CLI/API/worker contracts | 10 pass: database3, migrator5, API1, worker1 |
| Backend formatting | pass |
| Frontend | 2,532 pass across314 suites; focused268 across22 suites are included |
| Frontend lint | zero errors;72 existing warnings |
| Production build, generated client and bundle budgets | pass; entry39.95/40KiB gzip, startup70.97/90KiB gzip |
| React Doctor including untracked source | score92;77 scanned paths; zero errors and seven existing warnings; no new referral diagnostic |
| Full local ops | 151 pass/four existing opt-in skips;58 tracked source hashes unchanged |
| Generated contract | 490 operations,398 paths,1,082 schemas,3,447 resolved references; byte-identical final compiled exporter |
| Independent source reviews | no remaining concrete finding in the reviewed backend, recovery/UI and schema/ops scope |
| Frozen Rust workspace | 868 pass across137 groups, 0 ignored; composite acceptance: original full run867 pass/one fixture failure, complete corrected group9 pass |
| Native compiled synthetic acceptance | 138 HTTP checks pass;1,000 warm requests at concurrency5 allHTTP200 |
| Fresh isolated migration/startup | 96 migrations through024; actual copied schema CLI confirms024; readinessHTTP200 |

Actual baseline tests first reproduced old completion returning200 without a
state transition and an appointment/history committing before the referral root
lock. Both regressions pass after repair. A separate database counterexample
reproduced four inconsistent receipt forms before the scoped guard repair. The
original failing receipts and compiled-source fingerprints are retained locally.

All26 direct SQL and two query-builder fetches in the new response modules are
individually observed with static metric tags. Context reads use14 queries for
both one and106 revisions; history uses14 for one and101 rows,14 for the final
five-row seek and14 for an exact old version. A wrong-patient denial uses one.
The natural history plan uses the scoped version index beneath Limit101 with
1,000 unrelated roots. Its bitmap-index choice disproved an overly narrow test
expectation of only IndexScan/IndexOnlyScan; no planner setting or production
query was changed to satisfy that assertion. Raw plans and identifiers stay in
test memory. These are bounded query-cost checks, not production latency proof.

The generated OpenAPI SHA256 is
`86997f68a5e6f97ef4488ed3de29a2c9306c83648798c58db9aa00b912191d9a`.
Doctor is maintainability feedback, not accessibility/security certification.
Responsive controls were inspected and component-tested; rendered breakpoint,
physical-authenticator, cold-origin, capacity and staging acceptance remain open.
The optional unused SQLx MySQL RSA advisory remains unresolved. Pushed source
does not establish a deployed release.


The original full workspace command completed all137 groups with867 passes and
one failure during mandatory password-change fixture setup (HTTP401). The exact
unchanged compiled nine-test ward-round suite subsequently passed all nine. The
expiry fixture had started a four-second grant before authentication setup;
this timing overlap is an inferred test risk, not an established production
authentication cause. A test-only correction gives setup sufficient authority,
then arms the same four-second grant immediately before the actual expiry wait.
The complete corrected nine-test group passes. Production source did not change;
accepted coverage is868 unique tests across137 groups using that composite gate.
The original failure and independent rerun receipts are preserved.

Native acceptance exercises actual referral create/accept, UUID draft save,
manual atomic scheduling, Scheduled completion, terminal amendment, exact
historical revisions, immutable original receipt lookup and unchanged old UUID
replay. Changed UUID intent and retired legacy completion are definite conflicts;
routing DTOs keep protected response bodies redacted. The actual pure frontend
validators validate native response DTOs; this is not browser interaction.

Read-only isolated persistence confirms one referral, one linked manual
appointment/history, three response revisions/commands and five scoped audits.
The root matches the latest amendment, while original completion time and all
original receipts remain consistent. Existing template/note/treatment counts and
stock conservation remain unchanged from the combined checkpoint16 acceptance.
The primary database and human accounts are not modified. Temporary software
P256 key material exists only in process memory; physical devices are not tested.

All1,000 warm local debug requests at concurrency5 returnHTTP200:

| Protected read | Requests | HTTP200 | p99 |
| --- | --- | --- | --- |
| identity | 100 | 100 | 3.05 ms |
| assurance | 100 | 100 | 5.99 ms |
| factor status | 100 | 100 | 2.09 ms |
| registry | 100 | 100 | 4.60 ms |
| course list | 100 | 100 | 12.64 ms |
| course detail | 100 | 100 | 12.71 ms |
| template preview | 100 | 100 | 110.56 ms |
| template history | 100 | 100 | 6.71 ms |
| referral response context | 100 | 100 | 6.72 ms |
| referral response history | 100 | 100 | 29.60 ms |

These measurements exclude cold origin, edge, browser and production capacity.
Native foreign-scope, privilege-withdrawal and lock races are not separately
claimed; those controls are actual API/database regressions in the full workspace.
The eight optional checkpoint16 secondary-fixture controls remain explicitly not
run in the inherited native harness. Focused counts above are included in the
full workspace and are not added again as unique tests.

Compiled API SHA256:
`28373a843a7069547d90ba33374e2b2f05c87d901286f843b7d50ec5ae9ee20f`.
Compiled migrator SHA256:
`abf9b0c9f8b71bc0cde137fa7eb68a9609c4d56f5f0ac5e1be8de2814ea274f1`.
Exact frozen-source fingerprints, gate logs, native artifacts and static receipts
remain in local checkpoint evidence. Final documentation is the only source
updated after these gates.
