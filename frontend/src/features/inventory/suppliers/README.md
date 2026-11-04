# Governed inventory suppliers

Rust supplier maintenance lives at `/inventory/suppliers/*`, including existing
search-producer UUID deep links. One command controller spans the bounded
directory and exact current detail. The existing eight-field contact list,
item assignment and purchase-order supplier-name observations remain separate.

Read authority requires actual inventory view, demographics visibility,
deployment-capability view and Inventory feature grants with current
facility/profile/network evidence. Management adds inventory manage and a
writable decision. Server current authority and credential checks remain
authoritative; credential confirmation never creates a permission.

Administration directory rows have seven fields without contacts, addresses or
actor attribution. Exact current detail has fourteen supplier scalar fields and
unused-lifecycle eligibility. Ordinary eleven-field history contains recording
time, before/after revisions and change flags, never contact/address snapshots,
private correction reasons or actor identities. This does not add a new privacy
claim about the retained separately authorized contact-list endpoint.

Directory/history request25 rows using bounded server cursors; literal search
uses up to160 UTF-8 bytes. Keys hash search, cursors and opaque IDs within
sanitized visibility scope. Protected rendering requires its original response
identity and live scoped lease. Cancellation/denial, scope replacement and ABA
transitions cannot revive cached private data or local review copies.

All create/correct requests include contact_name,phone,email,address explicitly
as nullable strings. Not recorded, empty text and whitespace stay distinct.
Unchanged legacy values remain exact, including malformed, control-bearing or
oversized text. New/replaced nullable text is not trimmed. New code/name/reason
is normalized under the authored bounds. Email is plain text; quoted ASCII
local parts and IDN domain syntax are checked authoritatively by the server,
with no DNS/delivery claim. No HTML email validity or maxLength truncates old
values. Exact escaped contact/address review wraps in a single narrow column.

Create preserves a permanent code. Correction binds the exact current revision
and a reason. Retirement/reactivation is unused-only and rechecks current item
references, including inactive or malformed references. Metadata maintenance
does not rewrite item bindings or purchase-order observations. Supplier commands
update their own search projection in the same transaction. Cached Omni results
can retain earlier supplier labels until cache turnover or refetch. Current
details and original receipts are distinct observations; a normal correction does
not require an operator rebuild.

Review snapshots raw values before async reads/hash work, confirms exact current
source, freezes canonical RAM input and requires separate consent. A synchronous
latch prevents duplicate writes and locks dismissal during dispatch. Unknown
outcomes retain the exact actor/request/body in RAM across close/navigation;
there is no automatic retry. Only an exact original actor-bound receipt with
matching request/action/subject/revision/digest and final current transport proof
can establish the original result. Ordinary reads never acknowledge it. Reload
discovery locates one retained same-scope opaque request identifier, stores no
body and requires a separate shared acknowledgment; missing/denied/ambiguous
results preserve the barrier. Confirmed success survives refresh failure.

The actual frozen Rust OpenAPI and generated client expose all eight supplier
operations, within the 540-operation API. One complete final frontend run passes
3,856 tests in 392 files, alongside all six gate groups/thirteen serial commands.
The scoped BoardUI scroll container establishes a local positioning context so
its absolute screen-reader label cannot escape into page-level overflow. The
accessible label and real horizontal scrolling are retained.

See [checkpoint 26B verification](../../../../../docs/v2/2026-11-04-checkpoint-26b-verification.md)
for the exact source, wire, build, dependency and runtime evidence.
Finite native/HTTP, guarded browser, visual and exact fixture-cleanup checks
pass; see the verification for the precise local scope and retained limits.
This is finite supplier administration, not complete procurement or Python/UI
parity; source and component checks alone are not native or deployment acceptance.
