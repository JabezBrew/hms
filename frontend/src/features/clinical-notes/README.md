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
- Note versions and free-text clinical content must not be logged.
- Template management must not bypass clinical-note permissions.
