CREATE INDEX IF NOT EXISTS visits_facility_clinic_status_time_idx
    ON visits (facility_id, clinic_id, status, checked_in_at, id);

CREATE INDEX IF NOT EXISTS visits_facility_appointment_time_idx
    ON visits (facility_id, appointment_id, checked_in_at, id)
    WHERE appointment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS triage_facility_assignee_status_time_idx
    ON triage_queue (facility_id, assigned_to_user_id, status, created_at, id)
    WHERE assigned_to_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS encounters_facility_visit_started_idx
    ON encounters (facility_id, visit_id, started_at DESC, id DESC)
    WHERE visit_id IS NOT NULL;
