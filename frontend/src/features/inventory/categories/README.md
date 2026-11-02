# Governed inventory categories

Rust category maintenance lives at `/inventory/categories/*`. One command
controller remains mounted across bounded directory and exact detail navigation.
The existing item category picker and immutable item receipt category remain
exactly `{id,code,name}`; parent maintenance uses separate versioned rows.

Read availability requires actual `system.deployment_capabilities.view`,
`inventory.view`, `patient.demographics.view`, demographics visibility, the
Inventory feature and current facility/profile/network evidence. Management
adds `inventory.manage`; dispatch also requires a writable decision. Roles and
credential confirmation do not create these grants. The deployment feature
wrapper retains its independently authorized capabilities read.

Directory, history and parent candidates request 25 rows using server cursor,
status and literal search (160 UTF-8 bytes). Query keys hash search, IDs and
cursors within sanitized authorization scope. Every rendered protected read
requires its original response identity and live lease. Current denial hides
private copies; read errors cannot revive stale state. Standard list envelopes
retain actual `{data,page,meta}` identity with strict row/page validation.

Create has a permanent code, name, explicit nullable description and direct
parent choice. Correction changes name, description and an explicit retained,
cleared or newly selected parent with a reason. Parent candidates come from
versioned management rows; the selected parent is read exactly and reviewed at
its current active revision. A later candidate error revokes earlier choices.
The server proves local graph integrity, cycles and its 64-hop resource policy.
The browser does not build a hierarchy, infer descendants or inherit membership.

New/replaced code uses 120 Unicode scalars / 480 UTF-8 bytes; name 100 / 400;
description 8,000 bytes; reason 1,000 / 4,000. New code/name/reason trim and reject
controls; description allows tab and newlines. Unchanged historical values stay
exact, including blank/long/spaced values. Null, empty and whitespace description
are distinct. Description is escaped plain text. Current and history layouts
wrap raw characters in explicit single-column grids at narrow widths.

Unused-only retirement/reactivation can be blocked by any retained item or
current child pointer, including inactive or malformed references. Pure immutable
historical observations are provenance, not current membership. Metadata
correction preserves item bindings and other child pointers. No destructive
delete, stock operation, inherited classification or item reparenting is offered.
Current category/item display reflects local corrections; general item search
can retain an older local category label until the existing explicit rebuild.

Review copies fields and protected observations before asynchronous work, reads
exact current subject/parent CAS, freezes the canonical RAM intent and requires
separate consent. The synchronous dispatch latch prevents duplicate POSTs and
locks dismissal while the write runs. Global mutation retry does not replay it.
An unknown outcome retains the exact actor/UUID/body through close/navigation;
only explicit unchanged retry or exact original receipt reconciliation is offered.
Ordinary directory/detail/parent/history reads cannot acknowledge uncertainty.
Original receipt validation binds actor, UUID, action, subject, version and digest
before applying the actual current response proof and acknowledgment boundary.
Reload discovery locates one existing current-scope opaque UUID only; it stores
no body and requires separate shared recovery acknowledgment. Missing, malformed,
denied, ambiguous and unavailable receipts preserve the barrier.

Server current-grant, credential and network checks remain authoritative. The
central Auth flow handles credential renewal without automatic category submit.
Confirmed original success survives failed current refresh, while a fresh edit
stays blocked until current reads succeed. General history exposes recording time,
before/after revisions and change flags only.
Directory rows contain identity, name/code, lifecycle, direct pointer and revision
metadata; they omit descriptions and actor provenance. Full descriptions and
parent observations are read only through exact current detail or the separately
authorized original command receipt.
