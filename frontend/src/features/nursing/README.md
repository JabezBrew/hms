# nursing feature

Status: active
Owner: Frontend/Nursing Workflow
Last reviewed: 2026-06-04
Scope: nursing API adapters, hooks, and Chronicle/Ward Board clinical components.

## Routes

No standalone nursing routes. Nursing work is launched from the workflow that
owns the patient context:

- OPD intake actions from clinic waiting rooms.
- Triage assessment from `/triage`.
- Ward tasks, vitals, fluids, treatment sheets, and medication history from
  `/ward-board` or `/wards/:wardId/board`.
- Patient-specific clinical data from `/patients/:id` Chronicle workspaces.

## Backend Contracts

- `/api/v2/nursing/*`
- `/api/v2/discharges/*`

## Invariants

- Patient clinical nursing data belongs in Chronicle context or authorized
  ward workflow surfaces.
- MAR, vitals, handoff, alerts, and treatment-sheet state are backend-authoritative.
- MAR date windows send patient/admission and UTC date bounds to Rust and follow
  its scoped cursors. A failed or unconfirmed page must fail the view rather than
  present partial dose counts. Windows are capped at 100 pages of at most 100
  doses and require a shorter date range if that bound is exceeded.
- Medication history uses server cursor Next/Previous navigation with an unknown
  total; it must not invent a one-page complete count from a facility preview.
- The active MAR grid records explicit Administered/Missed/Refused/Held outcomes
  through `/outcome`, with a reason when not given. It never posts anonymous
  create-and-administer doses in Rust mode. Unknown save results block another
  decision pending review; shared mutation retries are disabled. History, grid,
  patient MAR and pharmacy request caches refresh after attempts. Displayed
  period progress is not source prescription duration or course completion.
- Fluid entry lists send patient/admission and `[recorded_from, recorded_before)`
  UTC bounds before following the server's entry cursors. Failed, unconfirmed,
  or over-100-page reads are unavailable, not an empty or complete partial list.
- Fluid totals use `/api/v2/nursing/fluid-balance/summary`; daily trends use
  `/api/v2/nursing/fluid-balance/trends`. SQL aggregates all matching rows, while
  daily trend responses remain cursor-bounded. All-history trends preserve the
  complete scope rather than silently showing only a recent entry page.
- Rust fluid days and displayed entry times use UTC. One shared day rolls over
  at midnight for the open panel's entries and totals; selected history stays
  on its chosen date. Fluid creation never automatically retries. An uncertain
  response refreshes the entries and blocks another submission from that form.
- Current Rust fluid observations persist paired volumes, UTC time and validated
  metadata. Audited correction/void preserves original evidence and effective
  totals; physical deletion remains unavailable.
- Realtime/task updates must use authorized facility/ward/patient subscriptions.
- The Rust MAR includes source-linked as-needed orders with explicit prescriber
  interval/daily limits, indication and whole stock units per dose. One request
  creates a pending dose and normal pharmacy supply; it never invents an actual
  administration. Legacy unconfigured PRN orders remain visible but unavailable.
  Request forms use stable UUIDs, no automatic retries and uncertain-save locks.
  Admission-keyed state prevents an old patient's form surviving a context change.
- Pending pharmacy reads include both pending and partially supplied fulfillments,
  follow bounded server cursors, and fail on incomplete pages. Supply success must
  confirm the exact fulfillment and issued/remaining counts; uncertain issues
  block another stock write while the user reviews the refreshed records.

`fluid/` owns the Rust Chronicle fluid panel and facility rule page. Patient and
admission scopes are sent to bounded server lists; totals and conditions come
from complete server projections. Controllers retain exact uncertain commands
above dialog portals, and voided source history remains reachable through the
explicit review toggle. Rule publication has an independent admin permission,
reason, expected version and review step.

Treatment-header, alert and handoff bridge methods return explicit server pages.
New list keys hash the complete normalized query and include sanitized client
scope. Patient/admission/ward/date/status filters go to Rust before pagination;
invalid or out-of-scope rows fail the page instead of becoming an empty list.
The urgent notification monitor is a newest-page preview, reports overflow or
refresh failure and links to the ward-board urgency view. Treatment/supply lines remain a separate parity gap; see
`docs/v2/2026-10-16-scoped-nursing-lists.md`.

Handoff completion finalizes the sender's header only; it is not recipient
acknowledgment or a saved patient narrative. Non-keyed header creates and
finalization hooks never retry automatically. Server reference/feature guards
and atomic audit must confirm writes before any saved status is displayed.

`handover/` owns separately scoped patient narratives, append-only correction/void
and actor-bound original receipt recovery. It launches from Chronicle with current
authoritative FullClinical proof and requires original-ward assignment or existing
all-ward authority on the server. Intended recipient is metadata only; existing
ward header finalization is unchanged. See
`docs/v2/2026-10-16-patient-handover-scope.md`.
