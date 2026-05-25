# Realtime Delta and Optimistic UI Policy

Status: Agent 6 policy for the Rust V2 performance wave.

## Realtime Delta Envelope

Rust V2 realtime messages use a PHI-safe delta envelope by default:

| Field | Meaning |
| --- | --- |
| `event_type` | Static event key such as `ward_board.task_state_changed` or `dashboard.projection_freshness`. |
| `facility_id` | Facility UUID used for authorization scope, never a facility name. |
| `entity_type` | Static non-PHI entity family such as `ward_board_task`, `dashboard_projection`, or `laboratory_order_summary`. |
| `entity_id` | The changed operational entity or projection id. Do not use patient ids unless an endpoint-level policy explicitly permits it. |
| `version` | Monotonic entity/projection version. |
| `changed_fields` | Static field names only. No patient names, MRNs, notes, diagnoses, free text, or clinical payload labels. |
| `occurred_at` | Server timestamp for ordering and freshness display. |

Realtime channel names, cache-persistence paths, metric labels, and browser event labels must not include patient identifiers, patient names, MRNs, note text, diagnoses, or raw clinical payloads.

## Cache Patching

Apply exact TanStack Query patches only when the delta contains enough non-PHI metadata to update the cached projection safely. Examples:

- Ward-board task status: patch task status and open-task counters when the task id and next status are present.
- Ward-board queue status: patch safe aggregate fields such as `open_tasks`, `overdue`, and `last_updated`.
- Dashboard projections: patch freshness metadata only; do not recalculate dashboard projection values in the client.
- Laboratory orders: patch status summaries and remove orders from status-filtered lists when the server-confirmed status no longer matches the filter.

Fall back to invalidation when the delta is incomplete or would require client-side reconstruction of clinical state.

## Optimistic UI Categories

Safe optimistic:

- UI preferences.
- Task completion.
- Local workflow step state.

Pending-confirmed:

- Bed movement.
- Referrals.
- Lab orders.
- Discharge blockers.

Never fully optimistic:

- Medication administration.
- Controlled substances.
- Signed notes.
- Discharge finalization.
- Billing posting.
- Break-glass.

The server remains authoritative. Failed optimistic mutations must roll back to the previous cache snapshot or show an explicit error state when rollback is not safe.
