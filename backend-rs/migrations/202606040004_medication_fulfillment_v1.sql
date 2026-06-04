ALTER TABLE prescriptions
    ADD COLUMN IF NOT EXISTS route text NOT NULL DEFAULT 'oral',
    ADD COLUMN IF NOT EXISTS inventory_item_id uuid REFERENCES inventory_items(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS start_date date,
    ADD COLUMN IF NOT EXISTS duration_days integer CHECK (duration_days IS NULL OR duration_days > 0),
    ADD COLUMN IF NOT EXISTS first_dose_at timestamptz;

CREATE TABLE IF NOT EXISTS medication_courses (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    admission_case_id uuid NOT NULL REFERENCES admission_cases(id) ON DELETE CASCADE,
    prescription_id uuid NOT NULL REFERENCES prescriptions(id) ON DELETE RESTRICT,
    medication_name text NOT NULL,
    dose text NOT NULL,
    route text NOT NULL,
    frequency text NOT NULL,
    inventory_item_id uuid REFERENCES inventory_items(id) ON DELETE SET NULL,
    first_dose_at timestamptz NOT NULL,
    interval_minutes integer,
    generation_window_start timestamptz NOT NULL,
    generation_window_end timestamptz NOT NULL,
    status text NOT NULL,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (facility_id, prescription_id, admission_case_id)
);

CREATE INDEX IF NOT EXISTS medication_courses_patient_status_idx
    ON medication_courses (facility_id, patient_id, status, created_at DESC, id);

CREATE TABLE IF NOT EXISTS pharmacy_fulfillments (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    admission_case_id uuid NOT NULL REFERENCES admission_cases(id) ON DELETE CASCADE,
    prescription_id uuid NOT NULL REFERENCES prescriptions(id) ON DELETE RESTRICT,
    medication_course_id uuid NOT NULL REFERENCES medication_courses(id) ON DELETE CASCADE,
    status text NOT NULL,
    medication_name text NOT NULL,
    dose text NOT NULL,
    route text NOT NULL,
    frequency text NOT NULL,
    coverage_start timestamptz NOT NULL,
    coverage_end timestamptz NOT NULL,
    requested_dose_count integer NOT NULL CHECK (requested_dose_count >= 0),
    dispensed_dose_count integer NOT NULL DEFAULT 0 CHECK (dispensed_dose_count >= 0),
    inventory_item_id uuid REFERENCES inventory_items(id) ON DELETE SET NULL,
    dispensing_location_id uuid REFERENCES storage_locations(id) ON DELETE SET NULL,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    dispensed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    dispensed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (facility_id, medication_course_id)
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'pharmacy_fulfillments_dose_counts_check'
    ) THEN
        ALTER TABLE pharmacy_fulfillments
            ADD CONSTRAINT pharmacy_fulfillments_dose_counts_check
            CHECK (dispensed_dose_count <= requested_dose_count);
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS pharmacy_fulfillments_queue_idx
    ON pharmacy_fulfillments (facility_id, status, coverage_start, id);

ALTER TABLE medication_administrations
    ADD COLUMN IF NOT EXISTS prescription_id uuid REFERENCES prescriptions(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS medication_course_id uuid REFERENCES medication_courses(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS pharmacy_fulfillment_id uuid REFERENCES pharmacy_fulfillments(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS dose text,
    ADD COLUMN IF NOT EXISTS route text,
    ADD COLUMN IF NOT EXISTS frequency text,
    ADD COLUMN IF NOT EXISTS dose_sequence integer,
    ADD COLUMN IF NOT EXISTS is_dispensed boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS dispensed_at timestamptz,
    ADD COLUMN IF NOT EXISTS dispensed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS medication_administrations_course_schedule_idx
    ON medication_administrations (facility_id, medication_course_id, scheduled_at, dose_sequence)
    WHERE medication_course_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS medication_administrations_pending_dispense_idx
    ON medication_administrations (facility_id, pharmacy_fulfillment_id, is_dispensed, scheduled_at, id)
    WHERE pharmacy_fulfillment_id IS NOT NULL AND status = 'scheduled';

CREATE TABLE IF NOT EXISTS pharmacy_fulfillment_mar_entries (
    fulfillment_id uuid NOT NULL REFERENCES pharmacy_fulfillments(id) ON DELETE CASCADE,
    medication_administration_id uuid NOT NULL REFERENCES medication_administrations(id) ON DELETE CASCADE,
    PRIMARY KEY (fulfillment_id, medication_administration_id)
);
