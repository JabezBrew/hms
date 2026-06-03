CREATE INDEX IF NOT EXISTS admission_cases_facility_admitted_patient_idx
    ON admission_cases (facility_id, admitted_at, patient_id, id);
