# Inventory supplier governance

Status: finite implementation; [verification](2026-11-04-checkpoint-26b-verification.md)
records actual checks and remaining limits. Finite local native/browser/visual/cleanup acceptance passes; Git release identity is recorded separately.
Scope: current supplier metadata, unused lifecycle, original commands, preserving
provisioning and their Rust UI. This is not procurement or physical stock movement.

## Current observations and authority

The new administration directory returns seven scalar fields per row: identity,
code, name, availability, version, governed time and creation time. It uses stable
`(created_at, id)` ascending cursors, a default page of 25 and a maximum of 100.
Literal search covers code, name, contact, phone and email; addresses are excluded.
The compatible supplier contact list retains its separate eight-field contract.

Exact administration detail contains the fourteen supplier fields and a generic
item-reference lifecycle blocker. General history contains eleven scalar fields:
command identity, action, recording time, before/after versions and six change
flags. History does not disclose old values, reasons or actor identities. Nullable
creator/updater facts on exact current detail remain unknown for imported rows.

Ordinary directory/detail/history/contact reads retain current facility, session,
profile, network, Inventory, InventoryView and demographics authority through
result construction and final database time. Read-only access does not require
management authority or fresh write confirmation. Commands and original-command
receipt recovery require current management and ordinary credential proof. A
confirmation cannot supply a missing permission or visibility grant.

## Commands and exact text

The eight generated operations provide directory, create, exact detail, history,
own original receipt, correction, retirement and reactivation. Creation reserves
a permanent facility code and UUID. Correction requires the reviewed version and
a reason; lifecycle commands bind the reviewed version. An original
actor/request/payload match returns the
original receipt before evaluating later lifecycle or version changes. Another
actor cannot read or adopt that command. A no-op still records a receipt and audit
event while preserving the supplier version and governed timestamps.

Create/correct explicitly includes all four nullable choices: contact, phone,
email and address. Null, empty text and whitespace remain distinct. New code,
name and reason are trimmed; nullable values retain exact input. Publication
limits are code 120 Unicode scalars/480 UTF-8 bytes, name/contact 100/400,
phone 20/80, email 254/1016, reason 1000/4000 and address 8000 UTF-8 bytes. Address
allows tab, carriage return and line feed; other unsupported controls are refused.
Unchanged imported malformed or oversized fields remain exact when another field
changes. That exception preserves data and does not bypass current authority.

Changed nonempty email is checked with bounded local syntax, including quoted
ASCII local parts and IDN domains using the existing pinned IDNA library. The
server does not rewrite email, resolve DNS or establish deliverability. SMTPUTF8
local parts are not supported. The UI preserves raw legacy values without native
HTML email rejection or `maxLength` truncation and renders values as escaped text.

## References, search and provisioning

Any existing item pointer blocks retirement and reactivation, including inactive
or malformed foreign references. Every newly selected non-null item pointer must
retain an active local supplier lock. Intrinsic database guards cover all item
writers; an unchanged historical pointer and an explicit null remain separate.
There is no hard deletion, reassignment or assertion of commercial non-use.
Purchase-order supplier names are independent historical text and are not changed.

A successful command updates only its own supplier search document in the same
transaction, preserving its UUID and unrelated metadata. A conflicting source
owner or busy projection causes definite rollback of the supplier, command,
audit and projection. Documents require demographics and exclude address. Migration
032 performs the mandatory supplier-only repair even when optional search-family
rebuilds are disabled. It does not repair unrelated sources or immediately evict
cross-process Omni caches; cached labels can persist until turnover or refetch.
The UI opens current details and does not prescribe a manual rebuild after a
normal supplier correction.

Baseline and performance provisioning use missing-only canonical identity/code
handling. Existing configured names, contacts, availability, provenance and times
are preserved. An unavailable canonical supplier leaves an optional missing item
link null; provisioning does not substitute another supplier, resurrect a retired
row or rewrite an existing item timestamp. Completed performance-seed receipts
remain original observations rather than later eligibility checks.

Schema 032 is a breaking runtime epoch with immutable migration 031. Deploy and
startup schema checks fence the actual database epoch before serving. Historical
pre032 binaries are not claimed to detect future epochs independently; the
deployment protocol is part of the rollback fence.

## Reachable UI and interrupted writes

The workspace is reachable at `/inventory/suppliers/*`, including UUID deep links.
Its directory adopts the official BoardUI Table source through a React 18 ref
adapter and scoped clinical design tokens. It retains server paging and UUID
identity, without local sorting, selection or a global theme/framework migration.
The supporting UI continues to use the existing shared components.

Keys use sanitized authorization scope and opaque or hashed search/cursor facts.
Protected data and review copies require the original live response identity;
cancellation, denial, scope replacement and ABA transitions cannot revive them.
Review freezes raw canonical input, confirms the current version and requires
separate consent. A synchronous dispatch latch prevents duplicate writes and
dismissal during dispatch. Unknown outcomes retain the original actor/request/body
in RAM across close and navigation, with no automatic retry. Only the exact own
receipt and current transport proof can establish the original result. Reload
discovery stores an opaque request identifier, never a body, and requires separate
acknowledgment. Successful confirmation survives a later refresh failure.

## Verification boundary

The [checkpoint verification](2026-11-04-checkpoint-26b-verification.md) records
the exact final source, complete local suites and separately bounded native
migration/HTTP/conservation, default plans and rendered desktop/mobile evidence.
A polished table or source test alone is insufficient.
Finite local native/browser/visual/cleanup acceptance passes; Git release identity is recorded separately.
This slice does not establish used-supplier lifecycle, purchase-order binding,
requisition conversion, stock fulfillment, whole-application parity, production
latency or a live deployment.
