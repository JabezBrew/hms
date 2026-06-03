ALTER TABLE patient_break_glass_grants
    ADD COLUMN chronicle_view_audited_at timestamptz;

CREATE INDEX audit_events_login_failure_burst_idx
    ON audit_events (facility_id, event_type, resource_type, resource_id, occurred_at DESC)
    WHERE event_type IN ('auth.login.failed', 'auth.login_failure_burst.detected');
