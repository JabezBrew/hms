CREATE INDEX IF NOT EXISTS encounters_facility_patient_started_hot_idx
    ON encounters (facility_id, patient_id, started_at DESC, id DESC)
    INCLUDE (encounter_type, status, ended_at);

CREATE INDEX IF NOT EXISTS encounter_care_team_active_order_idx
    ON encounter_care_team_assignments (encounter_id, is_active, created_at, id)
    INCLUDE (user_id, role);

CREATE INDEX IF NOT EXISTS patient_problems_facility_patient_time_idx
    ON patient_problems (facility_id, patient_id, created_at DESC, id DESC)
    INCLUDE (label, status, onset_date);

CREATE INDEX IF NOT EXISTS patient_allergies_facility_patient_time_idx
    ON patient_allergies (facility_id, patient_id, created_at DESC, id DESC)
    INCLUDE (substance, reaction, severity, status);

CREATE INDEX IF NOT EXISTS prescriptions_facility_patient_prescribed_idx
    ON prescriptions (facility_id, patient_id, prescribed_at DESC, id DESC)
    INCLUDE (medication_name, dose, frequency, status);

CREATE INDEX IF NOT EXISTS chart_entries_facility_patient_time_idx
    ON chart_entries (facility_id, patient_id, measured_at DESC, id DESC)
    INCLUDE (entry_type, value, unit);
