CREATE INDEX IF NOT EXISTS admission_cases_facility_discharged_ward_idx
    ON admission_cases (facility_id, discharged_at, ward_id, id)
    WHERE status = 'discharged';
