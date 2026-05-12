DROP INDEX IF EXISTS admission_cases_one_active_patient_idx;

CREATE UNIQUE INDEX admission_cases_one_active_patient_idx
    ON admission_cases (facility_id, patient_id)
    WHERE status IN ('ready_for_activation', 'admitted', 'discharge_pending');

CREATE INDEX IF NOT EXISTS admission_cases_facility_created_idx
    ON admission_cases (facility_id, created_at, id);
