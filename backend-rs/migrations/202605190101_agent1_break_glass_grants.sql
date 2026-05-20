CREATE TABLE patient_break_glass_grants (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    category text NOT NULL CHECK (
        category IN (
            'life_threatening_emergency',
            'patient_unconscious_or_unidentified',
            'handover_or_assignment_gap',
            'urgent_clinical_continuity',
            'other_emergency'
        )
    ),
    reason_text text,
    started_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    ended_at timestamptz,
    ended_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    request_id text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (expires_at = started_at + interval '2 hours'),
    CHECK (ended_at IS NULL OR ended_at >= started_at),
    CHECK (reason_text IS NULL OR length(btrim(reason_text)) > 0)
);

CREATE INDEX patient_break_glass_user_active_idx
    ON patient_break_glass_grants (facility_id, user_id, expires_at DESC, patient_id)
    WHERE ended_at IS NULL;

CREATE INDEX patient_break_glass_patient_active_idx
    ON patient_break_glass_grants (facility_id, patient_id, expires_at DESC, user_id)
    WHERE ended_at IS NULL;
