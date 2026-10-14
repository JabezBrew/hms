-- My Patients derives temporary assignments from current encounter ownership and
-- care-team membership. These scoped indexes avoid scanning other clinicians'
-- active work or historical care-team rows before building the cursor page.
CREATE INDEX IF NOT EXISTS encounters_active_owner_context_idx
    ON encounters (facility_id, created_by_user_id, started_at DESC, patient_id DESC)
    INCLUDE (visit_id)
    WHERE status = 'in_progress';

CREATE INDEX IF NOT EXISTS care_team_active_user_context_idx
    ON encounter_care_team_assignments (user_id, encounter_id, created_at DESC)
    WHERE is_active = TRUE;
