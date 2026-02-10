# Backend Domain: dashboards

Owner: Engineering (current owner: @jebre)
Last reviewed: 2026-02-10
Status: Active
Scope: API and operational notes for `backend/apps/dashboards`.

## API Surface

Base prefix: `/api/dashboards/`

Routes:

- `my-work`
- `clinic`
- `nurse`
- `inpatient`
- `reception`
- `admin`
- `admin-v2` (+ `capacity`, `workforce`, `compliance`)
- `my-context-patients`

## Security Notes

- Dashboard data must be role-scoped and facility-scoped.
- Do not leak cross-team assignment details.

## Performance Notes

- Dashboards are hot paths; target low p99 latency.
- Use cached projections and async refresh patterns.
