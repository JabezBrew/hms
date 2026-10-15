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
- Current Rust fluid entry capture persists volume and time. Category, subtype,
  colour, notes, amendment and deletion remain unsupported and must not be
  presented as saved clinical facts.
- Realtime/task updates must use authorized facility/ward/patient subscriptions.
