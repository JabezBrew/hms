# Explicit appointment series

## Source evidence and implemented scope

The Python recurring-rule model stores daily, weekly and monthly patterns. Its
generator uses a fixed 9am time, placeholder patient/practitioner identifiers and
approximate monthly dates. It is not an implemented capacity-backed booking
workflow. The old unexposed Rust helper accepted one session for every date and
committed its header and individual appointments separately.

This slice books an explicitly reviewed set of 2–50 actual session slots within
180 days. It does not expand recurrence rules or create background appointments.
Each occurrence has its own session and exact timestamps. Fixed slots must match
the offered grid, including the final shortened slot; capacity-block appointments
must match their whole offered block. All occurrences use the same patient,
active facility clinic and active service. The server derives practitioners from
the locked sessions and rechecks service constraints, blocked times, capacity and
any explicit overbooking reason. Manual bookings are outside this series path.

## Persistence and concurrency

Creation locks all sessions in ascending ID order and practitioners in ascending
ID order. The series header, every member, booking history and minimal audit
event commit together. A later conflict or audit error leaves no partial series.
The existing single-booking helper now accepts an enclosing transaction; the
older repository-only series helper also uses that atomic seam.

The client supplies one stable request UUID. Only its hash and the canonical
payload fingerprint are stored. Same-facility, same-actor exact replay returns
the original membership and current states, including after cancellation.
Reusing a reference with changed instructions is rejected. A same-actor request
lookup supports lost-response recovery, and a bounded patient-scoped list makes
saved series discoverable. Lookup does not authorize retry with a new reference.

Session exceptions share the session lock with booking. Practitioner exceptions
take an exclusive practitioner lock while bookings hold shared locks. The
exception does not then request session locks. Rescheduling takes the session
before its member, matching session cancellation. Arrival locks and rechecks the
appointment before creating/reusing a visit; it cannot revive a cancelled member.
No external work runs inside these transactions.

## Review and future cancellation

Patient authorization precedes every series response or mutation. Detail is one
bounded SQL projection, so a member action cannot split the response across
different snapshots. Patient identity appears once, with minimal slot rows.
Query keys and client routes must use opaque IDs and sanitized access scope.

The opaque `snapshot_token` covers sorted member identity, session, practitioner,
times and status. It detects ordinary appointment actions without requiring
every old writer to maintain a series version counter. Future cancellation locks
the member rows and checks that token before deciding against the database clock.
Only future Scheduled appointments are cancelled. Checked-in, past and other
terminal members remain unchanged. Cancellation history, changed/retained IDs,
the original cutoff and the action audit commit together.

An exact cancellation replay returns that saved cutoff and changed/retained IDs;
it does not redefine “future” later or rewrite reasons/history. UI confirmation
must distinguish future appointments cancelled from the retained series history.
Typed policy conflicts are definite rejections. Unknown commit or malformed
success results require review; writes must not automatically retry or mint a new
request reference while the original outcome is unresolved.

## Verification and remaining work

Repository and HTTP tests use actual booking, arrival, exception and cancellation
interfaces. They cover exact concurrent replay, late-capacity rollback,
deterministic multi-session competition, active references and grids, stale
snapshots, retained arrived/past members, fixed cancellation receipts, audit
rollback and the exception/reschedule/arrival races.

Typed daily/weekly/monthly recurrence expansion, timezone and daylight-saving
rules, automatic scheduling and whole-series rescheduling remain future work.
The active UI must describe this scope as explicitly selected appointments.
