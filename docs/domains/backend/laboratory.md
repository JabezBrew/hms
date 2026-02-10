# Backend Domain: laboratory

Owner: Engineering (current owner: @jebre)
Last reviewed: 2026-02-10
Status: Active
Scope: API and operational notes for `backend/apps/laboratory`.

## API Surface

Base prefix: `/api/laboratory/`

Routes:

- `tests`
- `panels`
- `orders`
- `specimens`
- `results`

## Security Notes

- Validate patient/result visibility by facility and role.
- Minimize returned fields for list endpoints.

## Performance Notes

- Large lab result sets require indexed date range filters.
- Avoid `DATE(column)` transformations in query filters.
