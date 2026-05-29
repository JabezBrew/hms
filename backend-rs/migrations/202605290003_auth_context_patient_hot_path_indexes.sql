CREATE INDEX IF NOT EXISTS refresh_sessions_active_session_validation_idx
    ON refresh_sessions (
        session_id,
        user_id,
        facility_id,
        session_version,
        permission_version_at_issue,
        expires_at
    )
    WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS authority_appointments_active_user_lookup_idx
    ON authority_appointments (facility_id, user_id, starts_at, id)
    INCLUDE (position_id, ends_at)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS permission_assignments_active_grantee_lookup_idx
    ON permission_assignments (facility_id, grantee_user_id, starts_at, id)
    INCLUDE (permission_code, scope_type, scope_id, ends_at)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS delegations_active_delegate_lookup_idx
    ON delegations (facility_id, delegate_user_id, starts_at, id)
    INCLUDE (permission_code, ends_at)
    WHERE status = 'active';

CREATE INDEX IF NOT EXISTS admission_cases_current_patient_lookup_idx
    ON admission_cases (facility_id, patient_id, admitted_at DESC, id DESC)
    INCLUDE (ward_id, bed_id)
    WHERE status IN ('admitted', 'discharge_pending');
