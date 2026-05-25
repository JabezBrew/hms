ALTER TABLE clinic_sessions
    DROP CONSTRAINT IF EXISTS clinic_sessions_owner_type_check;

ALTER TABLE clinic_sessions
    ADD CONSTRAINT clinic_sessions_owner_type_check
    CHECK (owner_type IN ('facility', 'practitioner', 'team', 'clinic', 'service', 'department', 'resource'));
