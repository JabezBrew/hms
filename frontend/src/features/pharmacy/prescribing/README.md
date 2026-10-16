# Chronicle prescribing courses

Status: active Rust V2 feature, launched only from the patient Chronicle medication menu.

A fresh, patient-authorized prescription detail read supplies persisted instructions,
reason, regimen, source snapshot and successor identity. Cached clinical detail is
hidden until the mounted read succeeds. Expanded detail and its commands require
server-authorized full clinical visibility; workflow manage permission alone is
insufficient and a denied detail read exposes no cached clinical content. Capability, facility, profile, session,
permission and patient changes discard copied local state. The menu reaches this
feature through the Chronicle patient provider; no standalone clinical route exists.

Documentation changes use the dedicated PATCH command and actor-bound receipt
lookup. Only active or held prescriptions without generated doses or PRN frequency/
policy permit documentation editing. Lists deliberately remain lean; full clinical
text appears in the authorized detail view and saved receipt.

Renewal requires a stopped/completed source. Replacement requires an active/held
source and atomically stops it on the server. The proposed regimen starts blank;
explicit source reuse copies a draft while leaving start/first-dose dates, stock
selection and change reason unchosen. Staff review the source, complete regimen,
current selected stock unit, patient identifier and change reason before saving.
An existing successor has a separate fresh read action. No action implicitly
creates a MAR schedule, pharmacy request or stock movement.

Scheduled/PRN conversion is rejected for a linked course. A new PRN course needs
explicit interval, rolling limit, indication and stock units. Earlier actual and
pending doses across linked courses count under the newly reviewed limits, even
when medication or stock changes; the UI does not claim earlier limits stay fixed.

Both commands freeze a stable client UUID, snapshot token and exact payload.
Unknown responses preserve the command across dialog close/reopen, permit explicit
original-receipt lookup or exact retry, and never generate a replacement key after
404. A validated immutable original receipt acknowledges only the exact locally
retained opaque attempt handle; a missing/malformed lookup never clears it. The shared opaque uncertainty barrier covers authorization/remount transitions;
manual workflow review remains required when an original controller is no longer
available. Typed receipts validate patient/source/regimen/documentation/stock basis
before acknowledging that barrier. Saved receipts survive list-refresh or caller
callback failures and are distinguished from current course state.

The modal uses a bounded scrolling body and persistent action/close footers. Pending
writes block Escape, outside dismissal and duplicate submission. Source and saved
views show authorized patient identity and clinical values rather than internal UUIDs.

Verification lives in __tests__/course-api.test.js, course-model.test.js and
course-workflow.test.jsx, plus affected create/actions/PRN integration tests. Tests
use the actual v2 fetch boundary. Browser rendering remains a separate release gate.

Linked scheduled prescriptions also require a separately reviewed positive whole
number of the selected catalog's base units for each dose. Dose text, strength and
pack size never determine this quantity, and source reuse does not copy it. The
saved policy is immutable course evidence; changing it requires a reviewed new
course. The typed create/new-course receipt must echo the exact reviewed unit and
quantity before confirmation or automatic MAR generation. An ignored/malformed
policy is an uncertain save and never triggers follow-up MAR or a second create.
Old linked courses with no policy remain explicitly unconfigured. Generic stock
linking excludes controlled items; a separate governed workflow is required.
