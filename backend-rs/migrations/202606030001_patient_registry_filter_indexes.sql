CREATE INDEX IF NOT EXISTS admission_cases_attending_status_time_idx
    ON admission_cases (facility_id, attending_user_id, status, admitted_at, id)
    WHERE attending_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS admission_cases_registry_filter_patient_idx
    ON admission_cases (facility_id, patient_id, ward_id, status, attending_user_id, admitted_at, id);
