CREATE UNIQUE INDEX IF NOT EXISTS visits_facility_appointment_unique_idx
    ON visits (facility_id, appointment_id)
    WHERE appointment_id IS NOT NULL;
