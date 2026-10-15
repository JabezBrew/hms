-- A decision not to give a dose is distinct from an actual administration.
ALTER TABLE medication_administrations
    ADD COLUMN reason_not_given text,
    ADD COLUMN administration_notes text,
    ADD COLUMN outcome_recorded_at timestamptz,
    ADD COLUMN outcome_recorded_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    ADD CONSTRAINT medication_outcome_reason_length CHECK (octet_length(reason_not_given) <= 1000),
    ADD CONSTRAINT medication_outcome_notes_length CHECK (octet_length(administration_notes) <= 2000),
    ADD CONSTRAINT medication_outcome_evidence CHECK (
        outcome_recorded_at IS NULL OR (
            (status = 'administered' AND administered_at IS NOT NULL)
            OR (status IN ('missed', 'refused', 'held')
                AND administered_at IS NULL AND administered_by_user_id IS NULL
                AND COALESCE(length(btrim(reason_not_given)), 0) > 0)
        )
    );

-- Only copy evidence that exists. Historical holds have no invented actor/time.
UPDATE medication_administrations
SET outcome_recorded_at = administered_at,
    outcome_recorded_by_user_id = administered_by_user_id
WHERE status = 'administered'
  AND administered_at IS NOT NULL AND administered_by_user_id IS NOT NULL;
