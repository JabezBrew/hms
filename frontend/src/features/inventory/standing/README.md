# Standing stock templates

The active Rust page uses `/api/v2/inventory/standing-order-templates`, distinct
from the older metadata-only standing-order endpoints. Generated client methods
carry real DTOs, version guards and cancellation signals. An older server
without these contracts presents an unavailable state.

Templates store distinct requesting and fulfilling locations, exact active
noncontrolled items, unit snapshots and positive whole quantities. Catalog-unit
changes require explicit quantity review before saving. Pause and cancellation
use a separate status operation so unavailable items cannot trap a template in
an active state. Cancelled templates are terminal.

Each due occurrence is generated explicitly. The server can create one catch-up
request and advances the next due date beyond today; no automatic scheduler is
promised. A saved request retains its source version and item/unit snapshots.
Generation and approval do not reserve or move stock.

Request review uses a fresh server read. Approval and full-request stock issue
require separate confirmations and `inventory.manage`. Issue is an atomic FEFO
transfer between the saved locations. Its receipt uses only confirmed server
status and quantities. Shortage, reference or unit conflicts leave a request
available for explicit cancellation; fulfilled requests cannot be cancelled.
Historical requests without item-backed provenance remain read-only summaries.

Writes never automatically retry, including under a global mutation retry
policy. Network errors, malformed success responses and typed `_unconfirmed`
errors remain uncertain. A request must refresh successfully before actions
resume. A confirmed receipt remains visible when a later refresh fails.
Query keys include the sanitized authorization scope and opaque IDs; no browser
storage contains form or request state.

Focused acceptance lives in `__tests__/standing-api.test.js`,
`standing-workflow.test.jsx` and `standing-page.test.jsx`. The last suite renders
the active pages through the real generated client and fetch boundary.
