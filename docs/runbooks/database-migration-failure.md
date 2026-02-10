# Runbook: Database Migration Failure

Owner: Engineering (current owner: @jebre)
Last reviewed: 2026-02-10
Status: Active
Scope: Recovery steps when migrations fail during deploy.

## Trigger

Use this runbook when migration job fails or web startup blocks on pending migrations.

## Severity

- Sev1 when production schema drift blocks traffic.
- Sev2 when failure is contained to pre-production.

## Preconditions

- Access to migration logs.
- Access to environment configuration.
- Confirm `DEFAULT_FACILITY_CODE` and safety gate settings where required.

## Procedure

1. Run preflight checks:
   - `python manage.py preflight_migration_checks --strict`
2. Identify failing migration and root error.
3. Validate migration dependencies and ordering.
4. Correct environment assumptions (for example required fallback facility code).
5. Re-run migration job.
6. After success, verify web process startup with pending-migration gate enabled.

## Verification

- `python manage.py showmigrations` reflects expected applied state.
- Application starts without schema drift errors.
- Critical API smoke tests pass.

## Follow-up

- Add regression test for discovered migration pitfall.
- Add ADR note if schema strategy changed.
- Update deployment docs if process changed.
