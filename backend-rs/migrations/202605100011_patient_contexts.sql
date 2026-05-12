CREATE TABLE patient_contexts (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    context_kind text NOT NULL,
    label text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, patient_id, context_kind)
);

CREATE INDEX patient_contexts_user_updated_idx
    ON patient_contexts (facility_id, user_id, updated_at DESC, patient_id DESC);
