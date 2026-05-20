CREATE INDEX IF NOT EXISTS visits_facility_clinic_time_idx
    ON visits (facility_id, clinic_id, checked_in_at, id)
    WHERE clinic_id IS NOT NULL;
