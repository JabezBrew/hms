# Governed storage locations

Rust-only maintenance at `/inventory/locations`. The route wrapper keeps the
legacy Django location form and its fields separate. Actual `inventory.view`,
`patient.demographics.view`, demographics visibility and the Inventory feature
are required before the directory query mounts. A role cannot substitute for
those facts. Management and actor receipts additionally require actual
`inventory.manage`; privileged-admin freshness hints do not grant or restrict
ordinary inventory authority.

The administration list is a bounded cursor directory, including inactive
records. Pages request 25 rows, with server filters and explicit bounded search.
Free text is hashed in private query keys. Historical classification strings
remain readable; create choices use only the current typed contract. Existing
stock/pharmacy selectors retain their active-only behavior. Stock navigation
uses the existing registered item route for its existing role audience.

Create supports permanent code, name, location type and temperature zone. Rename
changes only the name and remains available for used locations. Active-state
changes are limited to unused locations: recorded stock or operational history,
including zero-balance and completed records, may refuse retirement/reactivation.
This feature does not implement used-location closeout, stock mutation or item
administration. The controlled temperature zone grants no controlled-substance
authority.

Each change requires a fresh exact detail version where applicable, a canonical
reviewed command and a separate confirmation. Actual response/error object
identity plus query observation time invalidates unsent review, including
same-millisecond refreshes. Authority denial and scope changes remove private
copies. Losing write access interrupts a pending attempt, keeps its exact RAM
body/UUID for reconciliation and prevents late result publication.

Unknown commands retain the shared opaque recovery barrier. Ordinary close
preserves the fixed RAM request; retry cannot change its body. Directory,
detail, stock and history reads cannot establish the command's outcome. Only
the current actor's exact original receipt, strict typed input and canonical
SHA-256 digest can establish it. After reload, a deferred singleton accessor
can identify only an existing current-scope inactive request UUID. No body is
reconstructed; a separate generic recovery acknowledgment remains required.
Missing, denied, malformed and unavailable receipts preserve the barrier.

Server credential/network/current-grant checks remain authoritative. The UI
does not invent passkey or Admin requirements for InventoryManage, estimate
credential freshness, sign out implicitly or automatically retry after proof
renewal. Current credential confirmation is handled by the central Auth flow.

Exact family classification and original-receipt discovery load lazily on
write/recovery. Loader failure blocks dispatch. Shared synchronous denial,
dispatch, read lease and acknowledgment safeguards remain in their existing
recovery boundary.
