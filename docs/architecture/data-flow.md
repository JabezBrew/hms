# HMS Data and Request Flow

Owner: Engineering (current owner: @jebre)
Last reviewed: 2026-02-10
Status: Active
Scope: Request lifecycle, async boundaries, and critical safety checks.

## Request Path

1. User action in frontend feature route.
2. API call to Django endpoint under `/api/*`.
3. Backend validates authentication + role + facility/patient scope.
4. Queryset/object-level filtering in app views/services.
5. Serializer returns minimal payload for list endpoints.
6. Response is rendered in workflow-centric UI.

## Async Path

1. Request writes transactional state to PostgreSQL.
2. Background task is queued to Celery for external I/O or heavy work.
3. Worker executes task and updates local state/status.
4. UI receives refreshed state via API (and realtime mechanisms where available).

## Security and Safety Gates

- Access control enforced at queryset and object levels.
- PHI excluded from logs.
- Facility/user scope included in cache keys for scoped data.
- WebSocket channels require scope checks before subscription.

## Performance Gates

- No request-thread dependence on FHIR availability.
- List endpoints remain paginated and query-efficient.
- Heavy JSON/BLOB fields excluded unless explicitly requested.
- Date filters use range predicates (`[start, end)`) instead of `DATE(column)`.
