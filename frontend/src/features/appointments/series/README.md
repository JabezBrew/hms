# Multiple appointment booking

The active Rust booking page exposes **Several appointments** after the patient,
clinic and appointment type have been selected, with `appointment.manage`.
Select 2–50 real session slots within 180 days and review the complete list
before one atomic create. No appointment loop, manual slot, waitlist promotion,
automatic future generation or typed recurrence rule is implied by this feature.

The dedicated `/api/v2/scheduling/appointment-series` contracts use generated
operations. Each occurrence supplies its session and exact UTC timestamps; the
server derives practitioners from locked sessions and rechecks capacity,
eligibility, blocked times and overbooking reasons. A stable request UUID and
frozen payload support explicit replay and same-actor lookup after an uncertain
response. Writes have no automatic retries. Closing and reopening an uncertain
dialog retains its original request in local memory. Changing patient, clinic,
service or authorization identity discards the draft. No browser storage is used.

An existing member links to `/appointments/series/:id`. Fresh patient-authorized
reads gate membership and actions, including when the query cache contains older
data. Cancellation of future scheduled members requires the reviewed opaque
snapshot token, a reason and a stable request UUID. Its persisted receipt shows
the original server cutoff and actual cancelled/retained counts; it does not
claim that past, arrived or completed members were cancelled. Unknown cancellation
requests retain their exact payload for explicit replay, including across dialog
close/reopen within the page.

`model.test.js` tests bounded explicit occurrence construction.
`series-workflow.test.jsx` covers review, pending guards, unknown outcomes,
authorization/patient changes and fresh-read gates. `series-api.test.js` crosses
the real generated-client fetch boundary, including malformed success and
generic409 uncertainty. Existing single-appointment booking remains separate.
`series-page.test.jsx` exercises the reachable create and group pages through the
real generated client, including saved receipts across failed refreshes. Initial
create confirms the exact selected times; explicit original-request recovery
shows current member times after any legitimate later reschedule.
