# ward-board feature

Status: active
Owner: Frontend/Ward Workflow
Last reviewed: 2026-06-06
Scope: ward clinical task board UI.

## Routes

- `/ward-board`
- `/wards/:wardId/board`

## Backend Contracts

- `/api/v2/wards/my-board-context`
- `/api/v2/wards/board`
- `/api/v2/wards/staff-assignments`
- nursing task, alert, monitoring, MAR, treatment, and ward stock APIs

## Invariants

- `/wards/:wardId/board` is the canonical clinical board route for a single
  ward. `/ward-board` is a resolver/shortcut: it redirects users with one
  default assigned ward, shows an assigned-ward chooser when there are multiple
  wards, and only opens the house board when `scope=all` is explicit and the
  API reports `can_view_all_wards`.
- Ward assignment is the source of truth for ordinary clinical ward-board
  access. `ward_board.view_all` or admin staff/authority permission is required
  to load the board without a `ward_id`; the plain Wards feature must not grant
  that house-board permission by itself.
- Ward-board chrome must keep the active ward obvious. Ordinary clinical users
  may switch between assigned wards, but the in-board toolbar must not default
  them into a hospital-wide admitted-patient list.
- Patient rows stay fixed-height launch points. Patient-specific work opens in
  the side drawer so task details, Chronicle shortcuts, pending results, and
  discharge blockers do not stretch the board table.
- Admission state and clinical risk are separate concepts in the board UI.
  `Admitted` belongs in the status column; the risk column is only for urgency,
  alerts, overdue work, or pending clinical attention.
- Watchlist sections are board actions, not static summaries. Items should open
  the matching patient drawer when the row is visible, and section controls
  should move the board to the relevant operational view.
- Ward board reads must stay bounded and fast.
- Patient detail task reads must use Rust V2 patient/admission filters rather
  than fetching broad nursing task pages and filtering in the browser.
- Lane visibility must follow enabled features and permissions.
- Realtime/polling updates must preserve facility/ward/patient authorization.
