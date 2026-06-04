SET lock_timeout = '5s';

DO $$
DECLARE
    updated_rows integer;
BEGIN
    LOOP
        WITH remap AS (
            SELECT id
            FROM clinical_note_templates
            WHERE note_type NOT IN ('doctor_note', 'nursing_note', 'allied_health_note')
            LIMIT 1000
        )
        UPDATE clinical_note_templates
        SET note_type = CASE
            WHEN note_type IN ('nursing', 'nurse_note', 'nursing_note') THEN 'nursing_note'
            WHEN note_type IN ('allied', 'allied_health', 'allied_health_note', 'physio_note', 'physiotherapy_note', 'dietetics_note', 'counselling_note') THEN 'allied_health_note'
            ELSE 'doctor_note'
        END
        WHERE id IN (SELECT id FROM remap);

        GET DIAGNOSTICS updated_rows = ROW_COUNT;
        EXIT WHEN updated_rows = 0;
    END LOOP;
END $$;

DO $$
DECLARE
    updated_rows integer;
BEGIN
    LOOP
        WITH remap AS (
            SELECT id
            FROM clinical_notes
            WHERE note_type NOT IN ('doctor_note', 'nursing_note', 'allied_health_note')
            LIMIT 1000
        )
        UPDATE clinical_notes
        SET note_type = CASE
            WHEN note_type = 'discharge_summary' THEN 'doctor_note'
            WHEN note_type IN ('nursing', 'nurse_note', 'nursing_note') THEN 'nursing_note'
            WHEN note_type IN ('allied', 'allied_health', 'allied_health_note', 'physio_note', 'physiotherapy_note', 'dietetics_note', 'counselling_note') THEN 'allied_health_note'
            ELSE 'doctor_note'
        END,
        title = CASE
            WHEN note_type = 'discharge_summary' THEN 'Discharge summary'
            ELSE title
        END
        WHERE id IN (SELECT id FROM remap);

        GET DIAGNOSTICS updated_rows = ROW_COUNT;
        EXIT WHEN updated_rows = 0;
    END LOOP;
END $$;

ALTER TABLE clinical_note_templates
    DROP CONSTRAINT IF EXISTS clinical_note_templates_note_type_check;

ALTER TABLE clinical_note_templates
    ADD CONSTRAINT clinical_note_templates_note_type_check
    CHECK (note_type IN ('doctor_note', 'nursing_note', 'allied_health_note')) NOT VALID;

ALTER TABLE clinical_note_templates
    VALIDATE CONSTRAINT clinical_note_templates_note_type_check;

ALTER TABLE clinical_notes
    DROP CONSTRAINT IF EXISTS clinical_notes_note_type_check;

ALTER TABLE clinical_notes
    ADD CONSTRAINT clinical_notes_note_type_check
    CHECK (note_type IN ('doctor_note', 'nursing_note', 'allied_health_note')) NOT VALID;

ALTER TABLE clinical_notes
    VALIDATE CONSTRAINT clinical_notes_note_type_check;

CREATE INDEX IF NOT EXISTS clinical_notes_discharge_summary_signed_idx
    ON clinical_notes (facility_id, patient_id, updated_at DESC, id)
    WHERE note_type = 'doctor_note'
      AND lower(title) = 'discharge summary'
      AND status IN ('signed', 'amended');
