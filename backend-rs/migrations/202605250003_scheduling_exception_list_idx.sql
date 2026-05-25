CREATE INDEX IF NOT EXISTS appointment_blocked_times_facility_start_idx
    ON appointment_blocked_times (facility_id, starts_at, id);
