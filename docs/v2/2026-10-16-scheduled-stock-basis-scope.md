# Scheduled medication stock basis and care lifetime

Status: implemented with focused local verification; full release acceptance is
recorded separately. Rust V2 only.

Clinical dosage text and physical inventory quantity are separate. A linked,
non-PRN prescription now requires an explicitly reviewed
`scheduled_stock_policy: {expected_stock_unit, stock_units_per_dose}` on ordinary
creation and on a reviewed new course. Units are positive whole inventory base
units, bounded by the JavaScript safe-integer range; multiplication by dose count
is checked. No medication-text arithmetic, pack conversion, fractional unit,
or one-unit default is inferred. Generic scheduled policy cannot bind controlled
stock; the separate controlled-substance workflow remains separate.

The persisted policy returns `{stock_unit, stock_units_per_dose}` in detailed
prescription, course, queue, and MAR projections. Source, generated course, and
dose snapshots must agree. Generic regimen PATCH cannot change a configured
stock basis. Replacement/renewal uses the existing reviewed full-regimen command,
source token, provenance and immutable request receipt. Nothing automatically
generates MAR or transfers stock when creating a new course.

Migration `202610160016_scheduled_stock_basis.sql` deliberately leaves historical
policies, lot receipt units, and physical issue evidence null. Legacy scheduled
sources cannot generate, supply, or record a new Given outcome until a clinician
reviews a replacement (active/on-hold source) or renewal (terminal source).
Existing doses and stock are not reassigned to the successor. Recorded outcomes,
actual stock history and supplied quantities are retained. Historical units are
unknown unless captured at the actual reviewed operation; current catalog units
do not prove historical units.

Pharmacy `quantity` continues to mean number of doses. The response separately
returns `issued_stock_quantity` and `issued_stock_unit`; each supplied dose saves
its physical quantity and unit. Actual scheduled Given requires that evidence,
a current eligible local medication item, matching unit and active same-patient
admission. Existing explicitly configured PRN courses retain their policy/group
semantics and can use previously supplied rows without new migration-016 fields.
Scheduled non-Given retirement receives no new stock/admission prerequisite;
existing source, reason, timing and terminal protections still apply. PRN
non-Given outcomes retain their prior active-admission/item policy guards; this
does not promise PRN retirement after closure. Exact
terminal replay preserves the saved decision after current access/actor checks,
without demanding the patient still be admitted or the item still actionable.

Generation and physical issue also hold the current active same-patient admission
and item state through the transaction. Ordinary public prescribing now rechecks
selected active encounter and visit under locks in the insertion transaction.
A selected discharge case must still be requested and belong to the patient and
an active admission; its actual encounter/visit context is derived and validated.
Context-free outpatient/free-text prescribing remains supported. Retrospective
prescribing against closed care is outside this contract.

Controlled item units cannot change through generic catalog correction even
without stock history (controlled flag or controlled-substance type). Code/name
corrections remain supported. Dedicated controlled ledger DTOs and their actor
proof/unit-review modernization remain outside this slice; no new reviewed unit
is inferred for those older operations. Their first movement holds the item lock
before reading metadata.

Catalog unit changes are rejected once any batch, movement or dispense history
exists, including zero-balance lots. Code/name corrections remain available.
Every runtime stock writer takes the item lock, so the first receipt and catalog
unit correction serialize. Public batch receipts require `expected_unit`, checked
after the item lock, and save the reviewed received unit. New supplied-dose
quantity/unit evidence is constrained to a complete pair; legacy null/null
evidence remains explicitly unknown. A unit conversion needs
a new item and explicit reconciliation; this slice does not implement conversion.
Existing line-backed standing requests already snapshot and revalidate units.
Procurement GRN/transfer metadata operations remain metadata operations; this
change does not claim a complete procurement stock lifecycle.

Production generation, pharmacy physical issue (including the existing manual
inventory-unit path), dose outcomes, public receipt and catalog correction carry a
server-derived actor/session/profile/version/authority deadline proof. After
waits, facility/user/current session rows are verified and retained; a final
DB-clock deadline check prevents expired managed authority from committing.
Catalog correction also caps the proof at credential freshness. This is the
existing credential confirmation contract, not a strong MFA claim. Internal
fixture/import seams for these commands may omit the proof; their production
HTTP factories do not. This does not modernize all inventory or controlled-ledger
authority policies.

Lock order for source operations is prescription, actor facility/user/session,
PRN safety group where applicable, then care/admission and stock. A dose row is
locked before current action eligibility so an immutable terminal replay can be
recognized without requiring current care/stock eligibility. Physical issue
locks its fulfillment before the item/lots; the source/group lock serializes all
writers for that course. No catalog writer acquires those child locks. New-course
sorted item locks are shared and held across source-token and care validation.
Receipt/catalog operations take actor locks before item locks.
No external I/O occurs inside these transactions. Lists stay bounded with saved
policy columns and no per-row follow-up queries. Catalog history probes have
facility/item indexes.

Typed denials include `stock_policy_review_required`,
`prescription_stock_unit_changed`, `prescription_stock_item_not_actionable`,
`controlled_item_requires_controlled_workflow`, `admission_not_active`,
`invalid_scheduled_stock_policy`, `stock_quantity_overflow`,
`inventory_unit_in_use`, `controlled_stock_unit_immutable`, and
`stock_receipt_unit_changed`.

The existing physical issue API still lacks a request-UUID immutable recovery
receipt. Its atomic pending-dose checks and unknown-outcome review guard remain;
this slice does not claim idempotent physical issue recovery. Hold/stop reason
persistence, dedicated controlled-prescription-to-MAR integration, and historical
unit reconciliation remain separate work.

Focused local evidence: 88 repository tests across scheduled basis, lifecycle,
MAR outcomes, PRN, prescribing courses, inventory and standing stock workflows;
31 HTTP contracts across medication stock, prescribing courses, clinical, MAR,
pharmacy locations and the inventory journey. New cases include both catalog /
first receipt race orders, three admission-closure waits, selected visit checkout,
legacy discharge-context fallback, three session-revocation waits and five
managed-authority expiry waits. Owned Rust files are formatted and diff checks pass.
Parent verification records the full workspace and native/browser acceptance.
