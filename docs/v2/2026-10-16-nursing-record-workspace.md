# Scoped nursing records and confirmed decisions

The Chronicle vital form uses its selected admission before current-admission
fallback. The supported Rust fields retain exact numeric values; integer fields
reject fractions instead of truncating. Pain scoring is hidden until it has a
real Rust contract. Fields have accessible labels and show a second patient
identifier. Closing or changing clinical context removes copied form state.

Task and vital queries send patient, admission, ward, time, type, status and order
to Rust before LIMIT. Complete-window array consumers follow at most 100 pages
of at most 100 records. Malformed/duplicate/out-of-scope rows, repeated cursors,
failed reads or overflow fail the view. Failed vital refreshes hide cached charts;
visit-only history is explicitly unavailable. Time windows and authorization
scope are included in opaque query keys; all history has no implicit seven-day
cutoff. Scalar vital trends retain Summary access.

Create requests bind the known patient to the selected admission. A successful
response must match the exact patient/admission, fields and time; terminal task
responses must match the requested decision and original actor/time evidence.
Single-precision temperature representation uses a narrow numeric tolerance,
not clinical conversion. Unsupported notes/priority/acknowledgment are refused
or omitted, never silently treated as persisted.

Unknown results never retry automatically, including under a global retry
policy. They retain the opaque central uncertainty lock across ordinary close.
These non-UUID commands do not promise exact replay. A successful related read
plus explicit manual review can release the operational lock; it is not an
immutable command receipt or proof that the prior write was absent.

The active ward board uses the same complete server-scoped reads and receipt
adapters. Full clinical and nursing capability gate task narrative. Its table
paginates loaded tasks instead of hiding every row beyond eight. Counts refer
to visible authorized tasks. No optimistic Rust completion is published.
Old captured-ward tasks remain distinguishable after transfer; completion uses
current admission authority and cancellation remains an evidence retirement.
Context-bound callbacks cannot clear another patient's pending decision or
publish an obsolete notification.

Focused acceptance: 40 new checks cover query/window failures, exact receipts,
uncertainty recovery, real Host selection/reset, fractional-input rejection,
task pagination/visibility and actual controller pending-context races. Existing
bridge, ward page and trend suites also pass. React Doctor reports zero errors
with seven warnings: three complexity findings, a legacy index-key fallback,
two existing whole-query spreads and one existing sequential bulk-operation
loop. Sequential cursor reads require the preceding cursor. These diagnostics
are maintainability evidence, not security or accessibility certification.

Ward-round task production, richer treatment/supply workflows and the fluid
selected-admission/access audit are separate work. This does not establish full
Python nursing parity or browser rendering acceptance.
