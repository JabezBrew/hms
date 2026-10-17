# Admission placement and moves

This lazy Chronicle workspace reviews one explicit patient/admission case. It
does not select a current case from all history or an ambiguous encounter link.
Admission case handoff preserves the exact case before transient route options
clear. A destination is an explicit choice from a bounded eligible-bed page;
the workspace does not fetch a separate ward directory or choose a bed for the
clinician.

Current Full clinical proof, admission/demographics purpose and the backend's
current patient/ward relationship are required. The server's `can_move` also
accounts for current Nursing task authority when open tasks exist. Role names,
template management and encounter permissions are not substitute grants.

Review states the complete server open/assigned counts, the sole all-open routing
policy, assignment clearing, source-bed cleaning and the reason. A maximum of
500 open tasks is supported; no partial subset or 500-row body download is
offered. Same-ward bed changes still route all open tasks and clear assignments.
The original admission, encounter, visit and admission time remain distinct
from a bed-placement interval. Legacy observation timestamps do not establish
the unknown earlier occupancy start.

Every new move captures fresh placement, destination and task membership tokens
with a single request UUID. Submitted input stays in RAM and is compared with
the exact immutable receipt before success. Unknown outcomes preserve the same
request and body for explicit retry or original receipt lookup. There is no
automatic mutation retry. Original receipts and historical move detail have no
current move capability and never substitute for a fresh context.

If the reviewed input is lost, the opaque write barrier survives. A separate
explicit saved-placement review uses actual transport-stamped current reads,
then a newer matching read before a single-use acknowledgment. It reviews
current state and cannot identify the earlier outcome. Patient/case binding,
authority, denial epochs, source generations and active writers are fenced
across delayed response decoding and asynchronous hashing. Any new authority or
transport activation also invalidates earlier dispatch leases. Context, destination, history and ordinary exact
move reads never automatically acknowledge an unknown command. The phase18
follow-up applies the same digest-lifetime protection to referral manual review.

An authoritative physical revision refreshes this placement controller and
invalidates unsent move review. A same-ward bed revision does not globally erase
authorized pure clinical drafts or unrelated exact pending intent. A selected
ward change or current clinical denial tears down protected copies; only the
opaque barrier remains. Other clinical controllers retain their own fresh
prepare, CAS and current-denial policies.

Related adapters preserve task origin `ward_id` separately from effective
`service_ward_id` and safe-integer `route_version`. Report adapters preserve
nullable attribution, canonical unfiltered facility episode totals, recorded
per-ward transfer involvement and known placement lower bounds. They disclose
the server's occupancy measurement cutoff and never extrapolate future occupancy.

Focused acceptance uses the generated transport, the actual retained Host and
the real uncertainty store, with at most two test workers. Browser/rendered
acceptance remains a separate gate; responsive class/component checks do not
claim observed browser layout.

The retained handoff state intentionally captures an exact route case before the
router removes transient options; it cannot be derived from the later URL. The
small denied-access dialog deliberately follows the same audited shadcn pattern
as the other protected Chronicle workspaces rather than sharing their workflow
state. Doctor's derived-state and duplicated-wrapper suggestions for these two
seams do not justify losing the handoff or coupling authorization lifetimes.
