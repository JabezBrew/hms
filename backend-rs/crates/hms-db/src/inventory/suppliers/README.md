# Governed supplier repository contract

This document defines the bounded supplier slice; actual source-bound validation
and release acceptance are recorded separately.

The new directory is seven metadata fields. Fourteen-field exact detail includes
nullable contact/phone/email/address, current version/governed time, existing times
and true nullable provenance. Eleven-field general history contains command/action/
time, before/after versions and six change flags. It never expands private values,
reasons, snapshots or actors. The old eight-field list remains compatible.

Current reads retain InventoryView, Inventory feature, demographics permission/
visibility, facility/profile/session/network and final database time. Ordinary
onsite view does not require manage or fresh write confirmation. Writes and own
original receipt lookup retain current InventoryManage and fresh credential proof.

Create/correction explicitly includes all four nullable contact/address choices;
null and empty text are distinct. New code/name/reason are trimmed. Publication
bounds are code 120 Unicode scalars/480 UTF-8 bytes, name/contact 100/400, phone 20/80,
email 254/1016, reason 1000/4000 and address 8000 UTF-8 bytes. Address allows tab/CR/LF;
other unsupported controls are rejected. These are new Rust publication bounds,
not limits retroactively imposed on imported historical TEXT. Unchanged legacy
values remain exact while other fields change; current authority still applies.

Changed nonempty email uses bounded pure syntax: ASCII dot-atom/quoted local parts,
IDN domains through the pinned existing IDNA library, IP literals and localhost.
SMTPUTF8 local parts are unsupported. No stored text is rewritten; no DNS/SMTP or
deliverability check occurs. Empty and null remain distinct, and unchanged legacy
malformed email is preserved. Contacts/address remain escaped plain text.

Commands bind exact actor, request UUID and current CAS state. Replay validates
the original input before later current CAS/lifecycle and returns its original
observations without rejoining current supplier state. Noops still append their
receipt/audit. Definite projection lock/ownership rollback cannot publish partial
supplier/audit/receipt changes. The configured managed budgets are 100ms lock and 1000ms statement. Measured
query plans and loopback timing are separate from these configured limits; see
[checkpoint 26B verification](../../../../../../docs/v2/2026-11-04-checkpoint-26b-verification.md).
Finite native/HTTP/persistence, default-plan and conservation checks pass.
Measured timing is loopback evidence, not a production latency promise.

Every new non-NULL item pointer retains the exact active local supplier SHARE lock;
supplier lifecycle uses the conflicting row lock plus the global leading UUID
reference index. Any current pointer blocks retirement and reactivation, including
inactive/foreign malformed rows. There is no hard delete, reassignment or commercial
non-use promise. Existing PO names are unbound text and are never rewritten.

Own search refresh touches O(1) documents, preserves document UUID/unrelated JSON,
requires demographics and omits address. Different source ownership refuses the
write. Mandatory 032 repair is quiescent/scoped to real local supplier documents,
without orphan repair or immediate cross-process in-memory cache invalidation.
New directory literal search covers name/code/contact/phone/email; legacy search
stays at its original three fields. Row/query bounds are not a fixed-byte promise
for imported legacy text.

Focused checks, followed by full workspace/native/UI verification:

```sh
cargo test -p hms-db --test inventory_supplier_governance --test supplier32_provision --test schema_compatibility -- --test-threads=1
cargo test -p hms-api --test inventory_supplier_governance_contract -- --test-threads=1
```
