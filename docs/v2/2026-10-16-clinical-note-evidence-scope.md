# Clinical note evidence and template revision foundation

Status: implemented source; checkpoint acceptance is tracked separately.

## Product boundary

Patient notes remain in Patient Chronicle. Freeform notes remain supported.
Selecting a facility template records its immutable revision with the note;
subsequent template changes never reinterpret recorded content. New notes use
an active template root, but may explicitly pin an earlier reviewed revision.
An existing note continues to use its original schema even after that template
changes or becomes inactive.

This slice provides ordinary immediately effective facility-shared templates.
It introduces no mandatory publication approval, signing/attestation, private,
role or department sharing policy. Django exposes optional draft/review/publish
operations, but its ordinary serializers also publish revisions immediately;
mandatory admin review would therefore be a new policy, not repaired parity.
Django's historical `is_signed` label only tests history existence and is not a
supported signing workflow. Existing Rust statuses are retained for compatibility.

## APIs

- `POST /patients/{patient_id}/clinical/notes/record`: stable UUID, optional
  encounter and nullable template revision, type, title and exact body.
- `POST /clinical/notes/{note_id}/amendments`: stable UUID, expected version,
  mandatory reason and complete replacement body; earlier evidence is preserved.
- `GET /clinical/notes/{note_id}`: current protected detail, author and authoritative
  `can_amend`, plus pinned template structure when provenance exists.
- `GET /clinical/notes/{note_id}/history`: bounded metadata pages by descending
  version (`v:<version>` continuation); no bodies in collection results.
- `GET /clinical/notes/{note_id}/versions/{version_id}`: one exact saved body.
- `GET /patients/{patient_id}/clinical/note-requests/{request_id}`: immutable
  saved receipt, scoped to original actor and patient.
- `GET /clinical/note-templates`: metadata cursor catalog; active/inactive/all,
  note type and literal bounded title search are applied before `LIMIT`.
- `GET /clinical/note-templates/{id}`: current full revision, including inactive
  configuration, owner and authoritative `can_manage`.
- `POST /clinical/note-templates/record` and `/{id}/changes`: strict UUID commands,
  full reviewed snapshot and version CAS for changes.
- `GET /clinical/note-templates/requests/{request_id}`: original actor's immutable
  template receipt.

All paths above have the `/api/v2` prefix. Old note/template mutation routes and
old full-body `/versions` collection return `clinical_note_command_required`
with migration guidance after normal access checks. They cannot bypass the new
UUID, author, revision or reason requirements. They do not fabricate request IDs.

## Authorization and lifetime

Every protected note read and write requires current Encounters workflow access,
patient access and FullClinical visibility. Metadata Chronicle summaries remain
subject to their existing separate summary contract. Templates are nonpatient
configuration and do not require a FullClinical patient-data grant.

Amendment requires clinical management plus original authorship, or explicit
facility AdminAuthorityManage with the Admin feature and the same full clinical
workflow checks. Unknown legacy authors do not acquire ownership from the viewer.
Template changes similarly require original owner or explicit administrator;
legacy unknown owners remain unknown.

Source-bearing note reads/amendments lock the source first, then verify facility,
user, refresh session, versions, active profile and DB-clock authority deadline.
Template operations verify that proof before the template root. Encounters and
any used Admin feature are reread while holding the facility parent lock shared
with feature writers. Final deadline checks occur after waits and after audit
before commit. There is no transaction around network or other external I/O.

New note creation locks an explicitly selected active encounter and inherited
visit. Closing care while it waits prevents attachment to that stale context.
Historical author amendments and immutable exact receipt replay remain possible
after care closure, provided current access and session authority remain valid.

## Evidence and validation

Note title is trimmed, nonempty and at most 160 Unicode characters. Body is
preserved exactly, nonempty after trimming and at most 20,000 characters. Amendment
reason is trimmed, nonempty and at most 500 characters. Template body is preserved
exactly with the same 20,000-character bound; optional change summary is at most
500 trimmed characters. Bodies, reasons and titles never enter audit metadata.

A structured array or envelope `sections` template requires an object body.
Section keys use nonempty name, otherwise section, normalized by trimming,
lowercasing and retaining Unicode Letter/Number characters, matching legacy
Python and browser keys (including combining-mark removal). New structured
template commands require 1–100 distinct nonempty section names. An exact unchanged
malformed imported body may be retained only in a reviewed deactivation; active
new note selection rejects malformed structured schemas. Required strings and
containers must be nonempty; false and zero are valid scalar values. Unknown
non-underscore section keys are rejected. Plain text and legacy unknown-template
notes retain freeform compatibility. This is structured data validation, not
placeholder expansion or external terminology validation.

A facility/UUID command key is hashed and paired with actor, action, target and
canonical normalized payload digest. Duplicate identical commands serialize and
return the original saved result. Different payloads cannot reuse the key. Note
amendments serialize on one source row and compare its version. Audit, appended
version and immutable saved receipt commit atomically. Receipts deliberately have
`can_amend`/`can_manage` false: subsequent editing always starts from fresh detail.

Migration017 imports existing template text/array/envelope snapshots exactly as
revision one with unknown owner/actor and explicit imported provenance. Existing
notes gain no guessed template relation or author. Existing versions gain actual
parent facility scope, retain exact bodies and become immutable. Current template
pointer/snapshot consistency and root ownership/context identity are database
constraints. Trusted baseline/import inserts preserve explicit unknown provenance;
baseline reruns no longer overwrite existing template configuration.

## Bounds and compatibility

All catalog filters precede stable updated_at/id pagination; title wildcards are
escaped literally. Metadata history pages contain at most 100 rows; one expanded
body is fetched separately. No per-row queries occur. Authority proof adds a fixed
number of SQL statements independent of page size (seven for template catalogs,
eight for protected note history/detail, excluding service patient/context checks).
This is a query-shape bound, not a measured p99 claim. Existing indexes support
facility/current-state paging and facility/note/version history.

Saved evidence and command receipts prevent physical deletion of referenced
clinical notes. Demo reseeding returns `demo_seed_existing_clinical_evidence` before graph
deletion when saved note evidence exists; use a new isolated fixture database.
No general immutability bypass is added.
Schema017 must be applied before this API. No third-party deployment credential
or integration is required.

## Focused regression evidence

`hms-db/tests/clinical_notes.rs` crosses production repositories: duplicate command
and stale-source races; immutable context/body/reason/receipts; exact oldest history
beyond 100 versions; literal search/filtering/paging behind 105 unrelated templates;
pinned inactive/changed schemas; unknown author/admin override; actual legacy
migration fixtures; audit rollback; blocked reads/session revocation; entitlement
recheck; care closure during source wait and historical amendment afterward.

`hms-api/tests/clinical_notes_contract.rs` exercises actual HTTP: strict parsing,
protected detail/history/version/recovery, template metadata and provenance,
summary denial, retired-route denial, and simultaneous blocked reads/amendment
across natural managed-grant expiry and revoked session. Existing clinical journey
and visibility fixtures use the same strict commands; the nonpatient template
configuration positive control remains independent of patient-data grants.
