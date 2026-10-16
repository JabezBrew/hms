# clinical-notes feature

Status: active
Owner: Frontend/Clinical Documentation
Last reviewed: 2026-06-01
Scope: clinical note creation and template management.

## Routes

- `/encounters/:id/clinical-notes`
- `/clinical-notes/templates`

In Rust V2 the encounter-note compatibility route resolves its authorized patient
and hands off to Patient Chronicle. It does not render a standalone clinical
editor. An open encounter may request the note panel; a closed encounter opens
the Chronicle for review.

## Backend Contracts

- `/api/v2/clinical/note-templates`
- `/api/v2/patients/:patient_id/clinical/notes`
- `/api/v2/clinical/notes/:note_id/*`

## Invariants

- Patient notes belong in the Patient Chronicle/encounter context.
- Persisted clinical note types are limited to `doctor_note`, `nursing_note`,
  and `allied_health_note`. SOAP, HPI, ward round, discharge summary, wound
  care, and similar labels are template titles/structures, not note types.
- Note versions and free-text clinical content must not be logged.
- Template management must not bypass clinical-note permissions.
- Rust V2 templates are shared with authorized clinical staff in the current
  facility. Private, role, and department sharing choices are legacy behavior.
- Structured `body_template` values use a JSON envelope containing `sections`
  and presentation metadata such as `description`. Builder edits preserve
  existing metadata. The envelope must never determine access permissions.
  Existing array and plain-text template bodies remain compatible.

## Rust note workspace

`api/workspace.js`, `hooks/useNoteCommand.js`, and `components/` own the active
Rust workflow. The compatibility adapter and old workflow hook remain for legacy
consumers. Rust startup notes are lean metadata: opening a note requires a new
protected detail read before any body, amendment or copy action. History is a
cursor page of metadata; selecting one version loads that exact immutable body.
Fresh denials hide previously loaded content.

New notes support free text or an explicitly selected, freshly read template
revision. Structured sections retain JSON values and enforce the captured required
sections. Starter text is copied literally. Unresolved double-brace placeholders
must be replaced before save; this workflow does not substitute patient data.
The selected encounter is explicit, including null for all-history. A closed
encounter cannot receive a new linked note; authorized historical amendments stay
available according to the server's current `can_amend` fact.

Every record/amend/template command has a stable UUID, explicit review, strict
saved-receipt validation, and actor-bound immutable recovery. Amendments include
the observed source version and a reason. A missing, malformed or denied recovery
read never authorizes a fresh command. Exact validated recovery acknowledges only
the retained opaque original attempt metadata. Confirmed receipts remain visible
if a later refresh fails. Write feedback uses the existing scoped publication
lease; old actor, transport, permission or workspace results cannot publish.

Unsaved text is local memory, with no server-draft or autosave claim. The visited
Chronicle panel retains its controller across close while its DOM and queries are
absent. Patient, encounter, admission, transport or authorization changes discard
copied text. Reloading loses local drafts; the central opaque uncertainty ledger
still protects an unconfirmed dispatched write. Clinical text is never persisted
in that ledger or in query keys.

Templates remain shared with authorized staff in the facility. Ordinary saves
create effective immutable revisions; previous notes retain their selected
revision. The catalog uses server cursor/search/activity filters and supports
inactive templates. Owner/admin management capabilities come from fresh server
detail. This slice adds no mandatory approval, signing, private or departmental
sharing policy.

Malformed historical structured templates remain readable as raw evidence. They
cannot seed new notes or be silently converted into another schema. An authorized
owner may explicitly deactivate one with its original title, type and body kept
unchanged. Unknown section metadata and nontext starter formats in supported
templates are retained without coercing them into text.
