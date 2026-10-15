CREATE INDEX fluid_balance_entries_facility_patient_time_idx
    ON fluid_balance_entries (facility_id, patient_id, recorded_at, id);

CREATE INDEX fluid_balance_entries_facility_admission_time_idx
    ON fluid_balance_entries (facility_id, admission_case_id, recorded_at, id);
