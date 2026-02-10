# Runbook: Deployment Rollback

Owner: Engineering (current owner: @jebre)
Last reviewed: 2026-02-10
Status: Active
Scope: Recover service after failed web deployment.

## Trigger

Use this runbook when a new deployment causes elevated error rate, broken auth, or major endpoint failures.

## Severity

- Sev1 if clinical workflows are blocked.
- Sev2 if functionality is degraded but fallback exists.

## Preconditions

- Access to deployment platform and logs.
- Known last-good release identifier.
- Migration state known (applied/not applied).

## Procedure

1. Confirm impact via `/api/health/` and key route probes.
2. Freeze additional deployments.
3. Roll back web service to last-known-good release.
4. Verify DB schema compatibility with rolled-back version.
5. Run smoke checks:
   - auth login/refresh
   - patient list
   - encounter load
   - nursing dashboard
6. Reopen traffic only after smoke checks pass.

## Verification

- Health endpoint returns healthy.
- Error rate returns to baseline.
- No new migration mismatch exceptions in logs.

## Follow-up

- Open incident record with timeline.
- Add or update ADR/RFC if failure exposed design gap.
- Patch missing automation checks to prevent recurrence.
