# Referral consultation and encounter integrity — local acceptance

Checkpoint19 local acceptance binds its frozen source and actual generated
contract. No new browser, physical-authenticator, staging deployment or
production-latency acceptance is claimed here.

The consultation contract binds one immutable start to the exact patient and
referral. A reviewed command either creates a new outpatient encounter with an
explicit existing-visit/no-visit decision, or reuses the exact encounter of an
active admission without changing its original type or care context. Scheduled
referrals retain the actual appointment status, time, clinic and practitioner
snapshot at start. Starting does not complete the referral or grant clinical-note
authority. Original UUID receipts remain separate from current link state.

The generic encounter lifecycle must preserve visit/type/start identity once an
admission or consultation binds it. A terminal encounter cannot be reopened or
changed to the opposite terminal outcome. An active admission requires its owning
workflow. Historical completed `finished` spelling and timestamps remain stable.
Normal new-care intake blocks deceased records even when a restricted-record
intake override was supplied. Historical reads do not constitute new intake.

Actual regression baselines captured during implementation include accepted
identity retargeting, opposite terminal rewrites, terminal visit revival, a queued
admission publishing a stale encounter/visit tuple, and deceased restricted intake
creating care/audit effects. New migration guards and retained transaction proofs
are being verified against the production HTTP and repository interfaces.

The initial consultation persistence control exposed an ambiguous JSONB-minus
expression in a deferred completeness guard; a narrow parentheses correction
made the actual first-start control pass. A controlled two-request test then
observed the second request waiting on the unique request-key index while the
first valid request was paused before commit. Both requests completed after the
pause was released; this is evidence of the wait, not an unobserved deadlock.
The early scoped try-advisory reservation gate now returns bounded Busy with
zero second-command effects; the original first command commits exactly once.

Chronicle authority remains a separate acceptance requirement. A registered
patient's current eligible referral creator/acceptor and the immutable original
consultation actor need a narrowly scoped ordinary care relationship under
current clinical visibility, documentation view and feature grants. Global auth
and generic intake predicates must not be widened to achieve this. ADR0005's
restricted-record intake override does not grant access to the historical chart;
restricted preparation needs a minimal Chronicle panel whose own protected API
checks authorize only the reviewed consultation context.

Migration `202610170026` declares a breaking runtime boundary. The startup probe
checks its embedded checksum, essential typed/nullability layout, enabled guards
and actual index keys before provisioning or readiness. The local deployment
protocol's epoch parser, candidate chain and runtime declaration have been
extended together. The current ops gate passes161 cases with four existing
opt-in skips. Actual focused schema acceptance passes21 cases: database8, migrator7, API3 and
worker3, with unchanged schema/migration fingerprints through the focused run.

The complete frozen backend collection finishes146 target summaries with955
passes, two fixture failures and no ignored tests (original exit101, retained).
The four-second prescribing fixture published its short grant before first
credential setup/password change; its isolated original rerun passed, and the
repair moves real setup before the unchanged four-second grant. Original failure
timestamps were not measured. The stock-basis fixture tried to reopen the same
completed encounter, which migration026 correctly rejects. Its repair uses
separate initially completed and initially active fixtures while preserving
negative-context, exact derived encounter and canonical-discharge assertions.

The complete corrected prescribing10 and stock-basis14 targets pass. The
reconciled test inventory is957 passes with no unresolved failure; the original
workspace command did not exit zero. Production and all other3,291 source hashes
remain unchanged. Formatting, all four native binary builds and actual Rust
OpenAPI byte comparison pass.

The full frontend suite passes2,732 tests across327 suites. The final build then
exceeded the unchanged40KiB entry budget at40.02KiB. A narrow closed-selector lazy
gateway adjustment avoids an extra eager wrapper while preserving the response
protocol default, consultation dispatch authority and both shared denial/read-lease
guards. Actual final-source acceptance passes299 directly affected tests across16
suites and seven independent shared transport controls; lint0 errors/72 existing
warnings, actual generated-client check/build and all unchanged budgets pass.
Entry gzip is40,956/40,960 bytes (four bytes of headroom); startup71.02/90KiB.
The supported42-path Doctor scan has0 errors/eight warnings, score89,
baselineDegraded=true. Different scan scopes are not a comparable score baseline;
Doctor is maintainability feedback, not browser/accessibility/security acceptance.
The original full-run source, five-path load-only delta and final source copy are
preserved separately. This is affected-only verification after that load-boundary
change, not a claim that the original full suite ran against the later bytes.

Thirteen actual generated-client controls pass against the emitted Rust contract:
499 operations,406 paths,1,124 schemas and3,588 resolved local references. Independent
final review is bound to the final42-file manifest and both root-owned shared
files, with no open actionable production finding in that reviewed scope.

The care integrity slice passes21 focused cases:13 encounter HTTP contracts, one
actual vital-status intake HTTP contract and seven existing repository contracts.
Captured production-source hashes stay unchanged through these runs. These
focused results do not replace the complete frozen checkpoint19 workspace suite.

Sixteen focused consultation contracts and one vital-status contract pass. Eight
independent backend handoff/access/final-clock controls prove actual creator/
acceptor Chronicle entry, historical original-actor access, separate note-view/
management authority, exact linked note creation and final session expiry after
an actual wait. An offsite read-only context may be eligible for an onsite start;
its real POST remains403 even with a spoofed location header and leaves zero
effects. Eligibility is not a promise of offsite write authority.

The minimal denied-chart preparation panel retains one controller across a real
Chronicle403-to200 transition and never fabricates global chart permission. Exact
patient identity is current protected confirmation, not persisted command/cache
metadata. Notes, timeline and sidebar remain unavailable until a fresh authorized
Chronicle response. Async note leases prevent late private-note reopening after
denial/ABA. The narrow Chronicle purpose proof commits before the existing rich
DTO pipeline; no retained-through-body-publication claim is made for that pipeline.

Native acceptance passes111 actual HTTP checks, including all three actual
generated-client consultation operations and genuine software-P256 registration
plus a separate signed login assertion. Read-only verification confirms98
successful migrations/epoch026, four immutable consultation links, four commands,
four start audits and four exact receipts, explicit selected-visit binding and
exact existing-admission/triage encounter reuse. One clinical note and its command
persist; the read-only actor has no note or note-command effects. The immutable
six-field booking snapshot survives a later actual appointment update.

An initial110-HTTP attempt expected zero original-actor context rows after all
steps, but the canonical patient PATCH itself publishes a Recent context. That
attempt and its harness are preserved without acceptance. The corrected fresh
attempt adds a read-only zero-context checkpoint before the PATCH and verifies
the final sole row against that exact patient's update and audit timestamps.
No production behavior changed to fit the harness. The owned API process is
stopped; no other runtime or human account was modified.

The supported deployment protocol prevents old025 rollback after026 commits.
Old binaries are not assumed to recognize future migrations. Browser navigation
and remote staging retain the previously reported automatic approval-review blocks.
