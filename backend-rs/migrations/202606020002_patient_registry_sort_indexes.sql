CREATE INDEX IF NOT EXISTS patients_registry_code_sort_idx
    ON patients (facility_id, (lower(patient_code)), id);

CREATE INDEX IF NOT EXISTS patients_registry_status_code_sort_idx
    ON patients (facility_id, status, (lower(patient_code)), id);

CREATE INDEX IF NOT EXISTS patients_registry_name_sort_idx
    ON patients (facility_id, (lower(first_name || ' ' || last_name)), id);

CREATE INDEX IF NOT EXISTS patients_registry_status_name_sort_idx
    ON patients (facility_id, status, (lower(first_name || ' ' || last_name)), id);

CREATE INDEX IF NOT EXISTS patients_registry_dob_sort_idx
    ON patients (facility_id, date_of_birth, id);

CREATE INDEX IF NOT EXISTS patients_registry_status_dob_sort_idx
    ON patients (facility_id, status, date_of_birth, id);

CREATE INDEX IF NOT EXISTS patients_registry_sex_sort_idx
    ON patients (facility_id, sex, id);

CREATE INDEX IF NOT EXISTS patients_registry_status_sex_sort_idx
    ON patients (facility_id, status, sex, id);

CREATE INDEX IF NOT EXISTS patients_registry_status_sort_idx
    ON patients (facility_id, status, id);
