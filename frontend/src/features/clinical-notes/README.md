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
sections. Choosing a template preserves entered text and does not apply starter
content automatically. A separate patient-aware preview can propose defaults;
unresolved double-brace placeholders must still be completed before saving.
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

## Template history and reviewed shared copies

The active Rust catalog owns bounded revision metadata pages (25 per page), then
fetches one exact saved body on explicit selection. Saved revision availability
is separate from the current template's availability. Recorded user identity may
be unknown/imported; displayed user names are current facility metadata, not a
historical name snapshot. History requires current Encounters and documentation
view authority, without patient FullClinical or source-owner requirements.

“Create shared copy” prepares a new record, never an edit to the source. Current
management and network write authority are required. The copy starts inactive,
becomes facility-shared, and belongs to the current actor; this adds no private
copy or persisted source-lineage claim. Title, type, complete content and
availability require explicit review. The untouched saved body is sent byte for
byte, including array/envelope shape and unknown metadata. Supported deliberate
section edits retain unknown fields and the original root shape. Where JSON
round-trip would alter evidence (for example large numeric identifiers or
duplicate keys), body editing is disabled and the submission helper refuses it;
an exact-content copy remains possible. Malformed historical schemas remain
read-only and cannot seed a copy.

Copy commands use the existing stable UUID, original payload, immutable receipt
and actor-bound recovery protocol. Receipt validation requires a new template
and revision identity, exact content/availability and current-actor ownership.
Closing an uncertain editor keeps the original command in local memory; scope
loss clears copied content while the central opaque attempt marker remains.
Fresh protected-read denial clears the catalog editor and all selected content.
The unused legacy Array-history and duplicate helpers fail explicitly with
catalog guidance and make no Rust request; they do not fabricate empty history
or send a retired unreviewed create.

## Patient-aware template preview

“Preview note template” opens a separate retained Chronicle workspace under
current Full clinical read authority, documentation view, and Patient/Encounter
features. It can operate on a read-only network and has no Record or Amend action.
Its selected patient and encounter (including explicit all-history null) are
never replaced with a guessed current encounter. The server requires current
ordinary care access to a registered, living patient; a current denial clears
all protected preview and applied local copies. Earlier note/history rules stay
unchanged. The normal Add note workspace retains its existing write gate.

`api/templatePreview.js`, `templatePreviewModel.js`, `useTemplatePreview` and
`TemplatePreview` own an ephemeral read, not a note command. The request pins one
exact immutable template revision and the unchanged base body. Only an optional
clinician-supplied chief complaint is accepted as a caller token. Patient values
come from the server, and the displayed date basis is UTC. No demographic token
dictionary, arbitrary override, recursive evaluation or HTML rendering is added.

Empty-only is the default. A generated patch is shown first and requires patient
and content review before explicit local application. All/selected modes disclose
whole-section replacement and require separate confirmation. False/zero and
nonempty sections remain meaningful; unselected values and metadata remain. A
lossy JSON merge (including unsafe numeric metadata or duplicate keys) is refused
without changing the exact base body. Selecting a new template never clears typed
work; discarding that body requires the explicit start-empty confirmation.
Unresolved names/counts are displayed without token values and still require
manual completion before a later ordinary note save.

Patient, encounter, revision, authority, body or preview-input changes discard a
late response; close cancels the in-flight preview. Current403 unmounts the draft
and all patient-derived copies. Ordinary400/unsupported-template errors retain
entered work and never substitute old or fabricated preview content. Preview uses
an exact read-POST classifier and cannot create, acknowledge, clear or qualify as
saved evidence for any earlier uncertain write. The retired legacy render helper
now directs callers to Chronicle and makes no fake successful passthrough.
