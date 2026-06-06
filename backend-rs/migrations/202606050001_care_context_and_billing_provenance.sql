ALTER TABLE admission_cases
    ADD COLUMN IF NOT EXISTS encounter_id uuid REFERENCES encounters(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS visit_id uuid REFERENCES visits(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS admission_cases_facility_encounter_idx
    ON admission_cases (facility_id, encounter_id, admitted_at DESC, id DESC)
    WHERE encounter_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS admission_cases_facility_visit_idx
    ON admission_cases (facility_id, visit_id, admitted_at DESC, id DESC)
    WHERE visit_id IS NOT NULL;

ALTER TABLE discharge_cases
    ADD COLUMN IF NOT EXISTS encounter_id uuid REFERENCES encounters(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS visit_id uuid REFERENCES visits(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS discharge_cases_facility_encounter_idx
    ON discharge_cases (facility_id, encounter_id, requested_at DESC, id DESC)
    WHERE encounter_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS discharge_cases_facility_visit_idx
    ON discharge_cases (facility_id, visit_id, requested_at DESC, id DESC)
    WHERE visit_id IS NOT NULL;

ALTER TABLE prescriptions
    ADD COLUMN IF NOT EXISTS encounter_id uuid REFERENCES encounters(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS visit_id uuid REFERENCES visits(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS discharge_case_id uuid REFERENCES discharge_cases(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS prescriptions_facility_encounter_time_idx
    ON prescriptions (facility_id, encounter_id, prescribed_at DESC, id DESC)
    WHERE encounter_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS prescriptions_facility_visit_time_idx
    ON prescriptions (facility_id, visit_id, prescribed_at DESC, id DESC)
    WHERE visit_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS prescriptions_facility_discharge_time_idx
    ON prescriptions (facility_id, discharge_case_id, prescribed_at DESC, id DESC)
    WHERE discharge_case_id IS NOT NULL;

ALTER TABLE lab_orders
    ADD COLUMN IF NOT EXISTS encounter_id uuid REFERENCES encounters(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS visit_id uuid REFERENCES visits(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS lab_orders_facility_encounter_time_idx
    ON lab_orders (facility_id, encounter_id, ordered_at DESC, id DESC)
    WHERE encounter_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS lab_orders_facility_visit_time_idx
    ON lab_orders (facility_id, visit_id, ordered_at DESC, id DESC)
    WHERE visit_id IS NOT NULL;

ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS encounter_id uuid REFERENCES encounters(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS visit_id uuid REFERENCES visits(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS admission_case_id uuid REFERENCES admission_cases(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS invoices_facility_encounter_time_idx
    ON invoices (facility_id, encounter_id, issued_at DESC, id DESC)
    WHERE encounter_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS invoices_facility_visit_time_idx
    ON invoices (facility_id, visit_id, issued_at DESC, id DESC)
    WHERE visit_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS invoices_facility_admission_time_idx
    ON invoices (facility_id, admission_case_id, issued_at DESC, id DESC)
    WHERE admission_case_id IS NOT NULL;

ALTER TABLE invoice_lines
    ADD COLUMN IF NOT EXISTS is_auto_generated boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS source_type text,
    ADD COLUMN IF NOT EXISTS source_id uuid;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'invoice_lines_source_pair_check'
    ) THEN
        ALTER TABLE invoice_lines
            ADD CONSTRAINT invoice_lines_source_pair_check
            CHECK ((source_type IS NULL) = (source_id IS NULL));
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'invoice_lines_auto_generated_source_check'
    ) THEN
        ALTER TABLE invoice_lines
            ADD CONSTRAINT invoice_lines_auto_generated_source_check
            CHECK (NOT is_auto_generated OR source_type IS NOT NULL);
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS invoice_lines_facility_source_idx
    ON invoice_lines (facility_id, source_type, source_id)
    WHERE source_type IS NOT NULL AND source_id IS NOT NULL;
