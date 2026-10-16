# Patient handover

Patient-scoped nursing narrative is launched lazily from Patient Chronicle.
`PatientHandoverPanel` owns scope and fresh list access; `HandoverWorkspace`
retains the reviewed command outside the dismissible portal. `HandoverCurrent`
and `HandoverHistory` fetch current evidence and one immutable revision at a
time. `api.js` uses generated Rust operations and validates every returned scope
and exact write receipt. `keys.js` hashes clinical IDs, filters and cursors.

All seven narrative keys are explicit. Intended recipient is metadata only, with
an admission/original-ward scoped cursor picker; no notification or receipt of
handover is claimed. Corrections and voids append evidence with a reason and
expected revision. Original author, patient/admission and ward remain immutable.

A normal close retains a frozen uncertain UUID/payload, but renders no closed
clinical DOM and disables reads. Current authority/patient/admission/proof
changes discard copied clinical state; the shared opaque write-review barrier
remains. Unknown outcomes only permit original recovery/exact retry. No automatic
mutation retry or raw clinical query key is used. Current403 hides cached text.

See `docs/v2/2026-10-16-patient-handover-scope.md` for access, persistence and
release limitations. Focused tests are in `__tests__/`; actual generated fetch
and Host behavior are exercised, not just mocked hook calls.
