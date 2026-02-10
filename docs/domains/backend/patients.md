# Backend Domain: patients

Owner: Engineering (current owner: @jebre)
Last reviewed: 2026-02-10
Status: Active
Scope: API and operational notes for `backend/apps/patients`.

## API Surface

Base prefix: `/api/patients/`

Registered routes include:

- `fhir-mappings`
- `searches`
- `recent`
- `validation-rules`
- `notes`
- root patient viewset (`/api/patients/`)

## Security Notes

- Enforce patient access scope at queryset and object levels.
- Ensure list serializers do not expose full clinical payloads.

## Performance Notes

- Keep patient list endpoints O(1) per page.
- Defer heavy fields unless explicitly requested.

## Update Checklist

- API contract changed
- List serializer fields changed
- Access control logic changed
- Search query strategy changed
