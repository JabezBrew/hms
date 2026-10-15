# clinical-notes feature

Status: active
Owner: Frontend/Clinical Documentation
Last reviewed: 2026-06-01
Scope: clinical note creation and template management.

## Routes

- `/encounters/:id/clinical-notes`
- `/clinical-notes/templates`

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
