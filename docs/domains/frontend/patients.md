# Frontend Domain: patients

Owner: Engineering (current owner: @jebre)
Last reviewed: 2026-02-10
Status: Active
Scope: Route and UI notes for `frontend/src/features/patients`.

## Routes

- `/patients`
- `/patients/create`
- `/patients/my-patients`
- `/patients/:id`
- `/patients/:id/ward-round`
- `/patients/:id/edit`

## UX and Safety Notes

- Patient detail and clinical content should remain chronicle-centered.
- Role-based access must match route metadata.

## Performance Notes

- Patient list views should debounce search and avoid expensive re-renders.
