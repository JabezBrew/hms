# HMS Security Remediation Plan

Date: March 5, 2026

## Objective

Remediate the confirmed broken-access-control, PHI logging, and dependency hygiene issues identified during the March 5, 2026 source review and dynamic validation pass. The immediate priority is preventing unauthorized access to patient, prescription, lab, and allergy workflows without destabilizing clinical operations.

## Confirmed Findings in Scope

1. Same-facility non-authorized roles can retrieve rich patient profile details.
2. Same-facility non-authorized roles can modify prescriptions.
3. Same-facility non-authorized roles can advance lab workflows.
4. Same-facility non-authorized roles can deactivate allergy records.
5. PHI is written to audit logs, search history, startup logs, and operational logs.
6. WebSocket authentication still accepts query-string JWTs.
7. Backend and frontend dependency stacks are behind current security patch levels.

## Patch Order

### Wave 0: Immediate containment

Target: same day

1. Disable WebSocket query-string token auth in backend and frontend.
2. Remove startup logging of `DATABASE_URL`, `SECRET_KEY` metadata, and superuser identifiers.
3. Remove or reduce PHI-bearing audit descriptions and resource names in the highest-volume call sites.
4. Freeze any further role expansion on patient, prescription, lab, and drug-safety endpoints until access control is corrected.

### Wave 1: Access-control hotfixes

Target: 1-2 days

1. `PatientProfileViewSet`
   Scope read access by role and object. Billing, lab, pharmacy, and reception must not receive full profile detail by default.
2. `PrescriptionViewSet`
   Enforce `check_prescription_access()` for list, retrieve, update, and discontinue paths.
3. `LabOrderViewSet`, `LabSpecimenViewSet`, `LabResultViewSet`
   Enforce `check_lab_access()` on all object access and restrict state transitions by role.
4. `PatientAllergyViewSet`
   Restrict deactivate and modify operations to clinical roles with patient-level authorization.

### Wave 2: Privacy and logging hardening

Target: 2-4 days

1. Replace PHI-bearing audit messages with structured identifiers and action codes.
2. Stop persisting raw patient search strings.
3. Review `RequestLoggingMiddleware` and related logging for minimum-necessary output.
4. Confirm staging and production logging pipelines do not retain secret fragments or PHI.

### Wave 3: Dependency and platform remediation

Target: 2-5 days after Wave 1

1. Upgrade Django from `4.2.10` to the current patched `4.2.x` LTS line.
2. Upgrade `djangorestframework`, `djangorestframework-simplejwt`, and `gunicorn` to patched versions.
3. Upgrade frontend packages flagged by `npm audit`, starting with `react-router-dom`, `rollup`, and `minimatch` paths.
4. Re-run `pip-audit` and `npm audit` and hold deployment until high-severity items are cleared or risk-accepted.

## Owner-by-Owner Work Items

### Backend API owner

1. Replace facility-only queryset scoping with patient-domain scoping on patient, prescription, lab, and allergy endpoints.
2. Add explicit role gates for write actions and workflow transitions.
3. Keep serializers minimum-necessary by role and endpoint action.
4. Remove voluntary-filter authorization patterns where checks only run when `patient` is supplied.

### Clinical domain owner

1. Define approved reader and writer roles for prescriptions and allergies.
2. Define whether nurses may update specific prescription fields or only acknowledge/administer.
3. Define whether reception can view any patient detail beyond demographic registration data.
4. Validate break-glass expectations for note, prescription, and lab access.

### Laboratory owner

1. Map allowed transitions for order submit, collect, receive, process, verify, and complete.
2. Define separation of duties between ordering clinician, collector, technologist, and verifier.
3. Approve result visibility rules by role.

### Frontend owner

1. Remove query-token WebSocket fallback.
2. Align route guards and UI affordances with backend permission changes.
3. Trim UI data requirements so sensitive detail is not requested where not needed.

### Platform / SRE owner

1. Remove secret and admin-identity leakage from startup and deployment logs.
2. Confirm log sinks, CDN, and APM retain only redacted metadata.
3. Enforce runtime security checks in CI/CD: TLS, headers, dependency scans, and smoke authorization tests.
4. Keep edge HTTP->HTTPS redirect in place and enable app-level redirect as defense in depth.

### Security owner

1. Review all endpoints using `FacilityScopedPermission` without corresponding object-level patient authorization.
2. Convert security regression tests from `xfail(strict=True)` to hard-pass gates as each fix lands.
3. Define release criteria and sign off on remediation validation before production rollout.

## Verification Gates

### Test gates

1. `backend/tests/security/test_access_control_regressions.py` must move from `xfail` to normal passing tests as fixes land.
2. Add positive authorization tests for allowed clinical workflows so fixes do not break valid use.
3. Add query-count tests for any access-control queryset refactor on hot endpoints.

### Runtime gates

1. `pip-audit -r backend/requirements.txt` must show no unresolved high-severity issues without documented risk acceptance.
2. `npm audit --audit-level=high` must show no unresolved high-severity issues without documented risk acceptance.
3. Production and staging must reject cleartext token transport over WebSocket.
4. Logs sampled from staging must not contain PHI, secret fragments, or superuser identifiers.

### Release gates

1. Deploy Wave 1 fixes to staging.
2. Run the security regression suite and core workflow smoke tests.
3. Validate role-specific manual flows for doctor, nurse, lab tech, billing, receptionist, pharmacist, and patient.
4. Deploy to production only after staging sign-off from backend, clinical, and security owners.

## Rollout Notes

1. Land access-control changes behind small, reviewable PRs grouped by domain.
2. Do not bundle dependency upgrades with authorization logic unless required for compatibility.
3. Ship logging redaction before or with the first access-control rollout to reduce ongoing exposure.
4. Remove each corresponding `xfail` marker in the same PR that fixes the underlying issue.
