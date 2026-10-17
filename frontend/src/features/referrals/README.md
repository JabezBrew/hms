# referrals feature

Status: active
Owner: Frontend/Referral Workflow
Last reviewed: 2026-10-17
Scope: referral routing/status and a protected response workspace in Patient Chronicle.

## Routes

- `/referrals/inbox`
- `/referrals/sent`

## Backend Contracts

- `/api/v2/referrals`
- `/api/v2/referrals/:id/*`
- `/api/v2/referrals/clinic-waitlist/*`

## Invariants

- Referral state transitions are backend-authoritative.
- Waitlist promotion creates appointment/offer state through backend contracts.
- Cross-facility exchange/export is not implicitly enabled by referral UI.

## Governed Rust referral responses

Inbox and sent-referral controls hand off the exact patient and referral to
Patient Chronicle. A lazy retained workspace loads fresh protected context;
there is no current-referral or encounter fallback. The old Rust response
completion, response-update and start-consultation shortcuts refuse without
issuing a request. Standalone routing cards do not display specialist notes or
recommendations, including old cached values. This slice does not implement a
consultation encounter engine.

Current Full clinical visibility, Patients/Referrals, referral management and
patient demographics authority are required. The server also checks the actual
patient/referral relationship, session and network publication proof. Read-only
network access can review saved evidence; every new command separately requires
current write access and the current server capability. Role names grant no
implicit access.

Draft save, explicit completion and reasoned completed-response amendment are
separate reviewed commands. The complete submitted notes and recommendations,
original request UUID and source snapshot remain in RAM for an unchanged exact
retry. Nothing is autosaved. Normal close retains a mounted draft; patient,
referral, authorization or current denial tears down its clinical copies.
Completion is immutable evidence; an amendment preserves the original completion
time. Imported unknown bodies/authors/times remain unknown, and recorded response
status may differ from current routing status.

History fetches bounded metadata pages (25 by default, maximum100), then only the
explicitly selected immutable revision. It never fetches every page or substitutes
current content for an old revision. Query keys hash patient/referral/version and
filter values and include sanitized authority scope. Mutation retries are manual;
AbortSignal is preserved.

## Unconfirmed saves

Malformed success, lost transport and typed unknown-commit responses retain the
opaque shared write barrier. While the original RAM request exists, the workspace
can check its exact actor-bound receipt or explicitly retry those unchanged bytes.
Context/history/version reads cannot automatically confirm or acknowledge a save.

After a remount loses that RAM request, a separate manual flow fetches current
protected context and its matching current exact revision, shows the saved state,
and requires an explicit acknowledgment. It states that this review does not
identify the outcome of the earlier request. The shared protocol accepts only
actual transport read stamps and a new current read at the separate acknowledgment;
proofs are single-use, bound to one barrier and invalidated by context changes,
current denial or authority transitions. No clinical body, patient/referral ID,
credential or source token is persisted in the opaque marker. A later new command
still fetches current context and performs its own full review.

Browser/rendered acceptance remains pending the existing browser approval. The
component and generated-transport tests exercise the actual retained Host and
shared uncertainty store; they do not establish rendered breakpoint acceptance.
