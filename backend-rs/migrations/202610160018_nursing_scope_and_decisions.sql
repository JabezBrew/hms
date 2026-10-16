-- Historical tasks retain their existing status/time. No historical actor is inferred.
ALTER TABLE nursing_tasks
    ADD COLUMN completed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN cancelled_at timestamptz,
    ADD COLUMN cancelled_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX nursing_tasks_facility_ward_due_idx
    ON nursing_tasks (facility_id, ward_id, due_at, id);
CREATE INDEX nursing_tasks_facility_patient_due_idx
    ON nursing_tasks (facility_id, patient_id, due_at, id);
CREATE INDEX monitoring_events_facility_patient_recorded_idx
    ON monitoring_events (facility_id, patient_id, recorded_at, id);
CREATE INDEX patient_vitals_facility_patient_recorded_idx
    ON patient_vitals (facility_id, patient_id, recorded_at, id);

-- Existing empty imports remain readable; new records must contain a measurement.
ALTER TABLE patient_vitals ADD CONSTRAINT patient_vitals_has_measurement_check
    CHECK (num_nonnulls(temperature_c, systolic_bp, diastolic_bp, pulse,
                       respiratory_rate, oxygen_saturation) > 0) NOT VALID;
ALTER TABLE nursing_tasks ADD CONSTRAINT nursing_task_completed_actor_check
    CHECK (completed_by_user_id IS NULL OR
           (status = 'completed' AND completed_at IS NOT NULL));
ALTER TABLE nursing_tasks ADD CONSTRAINT nursing_task_cancelled_actor_check
    CHECK (cancelled_by_user_id IS NULL OR
           (status = 'cancelled' AND cancelled_at IS NOT NULL));
