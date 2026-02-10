# Backend Domain: workflows

Owner: Engineering (current owner: @jebre)
Last reviewed: 2026-02-10
Status: Active
Scope: API and operational notes for `backend/apps/workflows`.

## API Surface

Base prefix: `/api/`

Registered routes:

- `/api/workflows/`
- `/api/consultation-workflows/`
- `/api/clinical-note-workflows/`
- `/api/workflow-templates/`

## Security Notes

- Workflow state transitions must enforce role and context access.
- Prevent unauthorized cross-facility workflow reads.

## Performance Notes

- Keep workflow step updates lightweight and idempotent.
- Offload heavy suggestion generation to async execution.
