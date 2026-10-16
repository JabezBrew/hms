# Clinical note workspace and template revision foundation

Scope: Rust V2 Patient Chronicle note reading, recording, amendments, immutable
history and facility-shared template revisions. Python is a historical reference.

## Reachable behavior

- Lean startup/timeline metadata is never treated as a full note. A fresh protected
  detail read supplies the body, original author, captured template and current
  amendment capability. A failed read hides cached content.
- Version lists are bounded metadata pages. The body of an exact selected version
  is fetched separately. History/version denial also hides the current note.
- Freeform or structured notes have an explicit patient confirmation and review.
  Template selection fetches a fresh revision; the complete captured revision is
  verified in the saved receipt. Later template changes cannot rewrite it.
- Amendments preserve source identity/context/provenance, append the expected next
  version, require a reason and rely on current server author/admin capability.
  Unknown legacy authorship remains unknown; a receipt does not grant permission
  for another amendment. That requires a fresh current detail read.
- Templates use server search, cursor pagination and active/inactive/all filters.
  Owners and explicitly authorized administrators can save an effective full
  revision, including availability. No new approval or attestation policy is
  implied by this foundation.
- Malformed historical structured templates expose their original raw evidence
  and cannot be selected for new notes. An explicit owner-authorized deactivation
  retains the title, type and body unchanged. Supported template edits preserve
  unknown section metadata and nontext starter formats without coerced text.

## Lifetime and uncertain writes

The draft and reviewed command remain only in local component memory. A visited
note panel retains them across ordinary close, while closed patient DOM and
queries are absent. Selected patient/encounter/admission and sanitized current
authority/transport scope reset copied state. Note creation binds the selected
encounter explicitly; all-history does not silently choose the active encounter.
Closed encounters remain reviewable and may permit an authorized historical
amendment, but cannot receive a new linked note.

The four command routes use stable request UUIDs and immutable actor-bound
receipts. A possibly committed write freezes its exact payload and exposes only
an original-result check or explicit exact retry. A missing or malformed lookup
retains uncertainty. Validated recovery acknowledges only the original opaque
transport attempt. Stored uncertainty contains no clinical body, patient URL,
name, MRN, author identity or token. Reloading does not restore clinical drafts;
the existing manual review barrier remains available for unresolved commands.

The local editor makes no server-draft/autosave claim. Starter text is literal;
unresolved double-brace placeholders are blocked before save. Existing Python
AI/review/private-sharing paths are not represented as implemented Rust features.

## Verification boundaries

Focused model, real generated-client/fetch, actual Chronicle Host/dialog and
transport-guard tests cover successful and denied reads, stale source versions,
exact historical bodies, owner/author capabilities, required template sections,
all four lost-write commands, same-actor transport rotation, changed UUID/body
rejection, malformed receipt preservation, closed DOM/draft retention, scope
withdrawal, and known-save refresh failure. Backend persistence/authorization
tests are owned by the backend slice. These tests do not claim live browser,
clinical acceptance, signing or mandatory publication approval.
