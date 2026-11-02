# Inventory category governance

Status: implementation contract; release evidence is recorded separately
Owner: Inventory/Backend/Frontend Engineering
Schema epoch: `202610310031`
Scope: current category metadata, direct grouping and unused-category lifecycle.

## Workflow and permanent identity

Inventory managers can create a category, correct its current name and nullable
plain-text description, retain/clear/set its direct parent, and retire or
reactivate an unused category. Category UUID, facility, code, creation time and
original creator are permanent. This workflow has no effective-date input or
scheduled activation. Metadata changes do not reinterpret stock, move items or
children, replace immutable item category observations, or confer inherited
membership through a parent.

New codes use at most 120 characters/480 UTF-8 bytes, names 100/400,
descriptions 8,000 bytes and correction reasons 1,000/4,000. Name/code/reason
control characters are rejected; descriptions permit tabs and line endings.
Unchanged historical name/description values remain exact even when they exceed
new-input limits. Null, empty text and whitespace-only descriptions are distinct.
Creation and correction must explicitly include nullable description; creation
must explicitly include nullable parent. Parent changes are a closed
retain/clear/set choice; set includes the exact selected parent revision.

The direct parent must be active and local when newly selected or when a category
is reactivated. Its complete ancestry must be local, present, acyclic and within
64 hops. A later parent rename or active-state change invalidates an old selected
revision. Keeping a recorded pointer does not repair a missing or foreign parent.
Any current item or child-category pointer blocks a lifecycle change, including
inactive rows and malformed redundant facility references. Historical JSON
observations alone do not establish current membership.

## Access and publication

Ordinary directory, detail and history reads require current `inventory.view`,
demographics permission and visibility, and enabled Inventory capability and user
feature. Their mandatory read actor retains facility/profile/user/session/network
proof through result construction and checks the final database clock before
commit. Reads and access revocation serialize at that retained proof. Ordinary
onsite reads do not require management authority or fresh
credential confirmation; the configured offsite policy still applies.

Commands and original command receipts additionally require current
`inventory.manage` and fresh same-session credential proof. Receipt recovery binds
the facility, original actor and request UUID. Another manager cannot retrieve
the original actor's result. Current category/parent/history reads cannot resolve
an uncertain command outcome.

Commands retain the reviewed input fingerprint, original result and audit in one
transaction. Same-actor identical UUID replay returns the original result after
later category changes. A changed action/body conflicts. Compare-and-set uses the
current category revision; a genuine no-op preserves revision and category-change
time while recording its own immutable receipt/audit. Database guards protect
identity, version, command immutability and receipt/audit completeness. Facility
graph and global category-UUID gates refuse contention without waiting on a
conflicting category publisher; final authority deadlines are checked after
waits. No external I/O or search rebuild runs in a category command.

## HTTP and UI

| Purpose | Operation |
| --- | --- |
| Bounded current directory / create | `GET` / `POST /api/v2/inventory/category-administration` |
| Exact current detail | `GET /api/v2/inventory/categories/{id}/administration` |
| Bounded recording history | `GET /api/v2/inventory/categories/{id}/history` |
| Correct current metadata | `POST /api/v2/inventory/categories/{id}/corrections` |
| Unused lifecycle | `POST /api/v2/inventory/categories/{id}/retire` / `reactivate` |
| Original own UUID result | `GET /api/v2/inventory/category-commands/{client_request_id}` |

Directory pages default to 25, cap at 100 and use immutable `(created_at,id)`
descending keysets. Literal code/name search is bounded to 160 bytes. Directory
rows have exactly eight scalar metadata fields; history has exactly nine scalar
recording/revision/change fields. Neither returns descriptions, correction
reasons, full snapshots or actor identities. Exact detail and separately
authorized original receipts carry their richer content. The existing active
category picker remains `{id,code,name}`. Proof and page query counts remain
constant with page size; reference eligibility uses indexed existence checks.

The ShadCN category workspace is under `/inventory/categories`. It provides
search/status/page controls, exact detail and recording history, explicit parent
paging, refresh-and-review, consent, and original-result recovery. It preserves
raw historical values and current response provenance. A source change, failed
read or authority loss invalidates an earlier review. After an unknown write the
unchanged request remains fixed; recovery reads the original UUID result before
another change. Reloaded recovery does not reconstruct or automatically resubmit
a lost body. Query/cache scope uses sanitized authorization facts.

## Upgrade, provisioning and search

Migration031 preserves original category identity/text/lifecycle. Existing rows
start at revision1 with unknown new provenance and category-change time left
NULL. No historical actor or change time is inferred. The required-schema probe
checks exact relevant defaults, columns, indexes, constraints, trigger and
function definitions. The supported deployment path fences older runtimes after
this breaking epoch. An older030 binary cannot be assumed to recognize a future
031 schema; an old-on-new diagnostic is separate from that operational fence.

Canonical MED provisioning is missing-only. It preserves configured metadata,
parent, revision and retired state. Conflicting canonical UUID/code ownership
requires operator review. Missing default items still need the actual active
local canonical category; provisioning cannot resurrect a retired category or
borrow another category. Existing supplier-row provisioning is a separate
remaining parity task; category preservation does not establish supplier
preservation.

Live item category joins and future search producers observe categories only in
the item's own facility and retain a nullable category observation otherwise.
Migration031 repairs existing producer-backed inventory-item search documents
joined to their actual local item, independently of optional rebuild toggles. It
reconstructs item search text and the category metadata field while preserving
document identity and unrelated metadata. Orphan/mismatched producer documents
are outside this targeted repair. Repair cost is O(item documents), belongs in a
quiescent migration and must be measured separately from hot-request latency.

A later local category rename reaches general item search after the existing
explicit operator rebuild and cache turnover. Category administration reads
current state immediately. There is no synchronous unbounded rename fanout or
new incremental search projector in this scope.

## Verification

Run the focused repository/API/schema/provisioning suites, full Rust workspace,
compiled OpenAPI export and generated-client check. Execute honest historical
fixtures under their actual older schema without disabling guards; verify fresh
031 initialization and migration preservation separately. Prove both orderings
of read/revocation interleavings and final-clock expiry after a wait. Exercise
ordinary viewer access separately from manager writes and original receipts.

Frontend lint, complete unit suite, build, API generation, bundle budget and
matched-scope React Doctor checks precede guarded real-browser checks on fresh
synthetic actors. Native migration/HTTP/stock conservation and loopback latency
results are separate from production deployment and clinical performance
acceptance. Executed results and qualifications are recorded in the
[checkpoint25 verification](2026-11-02-checkpoint-25-verification.md). That note
does not expand this contract into full parity or production acceptance.
