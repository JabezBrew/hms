# Governed standing stock orders

## Source evidence

Python `apps/inventory/models.py` stores named standing templates with item
quantities and requesting/fulfilling locations. Its logistics service copies
those lines into a requisition, advances due tracking, and fulfills by transferring
stock. The prior Rust metadata contract stored only a requesting location,
frequency and next date. Its generator created an empty requisition header, and
metadata fulfillment changed a status without transferring stock. The old
supply-dispense path also allowed another issue against a fulfilled header.

## Implemented boundary

The separate `/api/v2/inventory/standing-order-templates` namespace supports
named, versioned, line-backed templates. Old servers cannot silently accept the
new form while dropping its items. Active same-facility locations and noncontrolled
catalog items are required. Input quantities are positive and unique by item;
each template/detail is bounded to 100 lines. The saved item unit is explicit.
Configuration checks the caller's reviewed unit against the locked catalog unit,
and changed units are exposed for review before generating another request.

An explicit due-generation request supplies the reviewed version and occurrence.
The parent template lock, unique occurrence record, line snapshot, audit event
and schedule update are atomic. A repeated occurrence returns the existing
request, including after configuration changes, without duplicating history.
One catch-up request advances the schedule beyond today in UTC; it does not
fabricate a backlog of requests. Daily, weekly, fortnightly and monthly schedules
are supported, with stable monthly day anchors and short-month clamping.

Generated requisition lines retain their original item code/name/unit and requested
quantity. Later template or catalog edits cannot rewrite them. A current-unit
mismatch blocks issue and requires a cancelled/reviewed replacement. Template
pause/cancel remains available when an item becomes inactive; resume revalidates
the references. Cancelled templates are terminal.

Requests have explicit audited approval and cancellation. Full issue requires
real approval evidence and transfers the exact saved quantities from the saved
source location to the receiving location using unexpired FEFO batches. Each
source allocation creates a receiving lot with the original lot number/expiry,
paired signed stock movements and linked allocation evidence. All lines, stock,
evidence, fulfillment state and audit changes commit together. No partial issue
is claimed. A shortage or audit failure leaves the whole request unchanged.

Request locks serialize competing issue/cancel actions. Fulfilled replay verifies
saved line/allocation evidence and creates no stock movement or new audit event.
Source batch selection and bulk writes are bounded to 500 allocations per issue;
a more fragmented request is rejected before stock changes. Expired stock and
controlled items cannot enter this ordinary issue path.

The old metadata generator and metadata-only actions cannot fulfill governed
requests. Historical manual header workflows retain their existing contract,
with repeated supply dispensing against a fulfilled header blocked. The Rust UI
keeps those historical headers read-only.

## Verification and remaining scope

Focused repository/HTTP/frontend checks cover strict DTOs, facility and permission
scope, cursor bounds, item units, schedule anchors, concurrent occurrence replay,
immutable snapshots, approval, conservation/expiry/lot evidence, competing stock
requests, cancellation, audit rollback and unknown responses. Integration owns
the final suite, generated-contract, browser and deployment gates.

Automatic scheduled generation is not implemented here. The worker must later
call the same idempotent occurrence workflow with bounded facility batches and a
defined system actor; the UI must not promise automatic generation before that
contract exists. Partial stock issue, direct ordinary handling of controlled
items, and inference of historical metadata-only order lines are not supported.
