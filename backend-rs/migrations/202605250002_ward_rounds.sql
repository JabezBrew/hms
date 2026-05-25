ALTER TABLE nursing_tasks
    ADD COLUMN title text,
    ADD COLUMN instruction text;

CREATE TABLE ward_rounds (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    admission_case_id uuid NOT NULL REFERENCES admission_cases(id) ON DELETE RESTRICT,
    status text NOT NULL,
    version bigint NOT NULL DEFAULT 1,
    note_sections jsonb NOT NULL DEFAULT '{}'::jsonb,
    review_rail jsonb NOT NULL DEFAULT '{}'::jsonb,
    rendered_note text,
    signed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    signed_at timestamptz,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ward_rounds_one_draft_per_admission_idx
    ON ward_rounds (facility_id, admission_case_id)
    WHERE status = 'draft';

CREATE INDEX ward_rounds_current_idx
    ON ward_rounds (facility_id, patient_id, admission_case_id, status, updated_at DESC, id);

CREATE INDEX ward_rounds_chronicle_timeline_idx
    ON ward_rounds (facility_id, patient_id, signed_at DESC, id)
    WHERE status = 'committed';

CREATE TABLE ward_round_actions (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    ward_round_id uuid NOT NULL REFERENCES ward_rounds(id) ON DELETE CASCADE,
    patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    admission_case_id uuid NOT NULL REFERENCES admission_cases(id) ON DELETE RESTRICT,
    action_type text NOT NULL,
    status text NOT NULL,
    title text,
    instruction text,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    committed_resource_type text,
    committed_resource_id uuid,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ward_round_actions_round_status_idx
    ON ward_round_actions (ward_round_id, status, created_at, id);

CREATE INDEX ward_round_actions_patient_type_idx
    ON ward_round_actions (facility_id, patient_id, action_type, status, created_at DESC, id);

CREATE INDEX ward_round_actions_committed_resource_idx
    ON ward_round_actions (facility_id, committed_resource_type, committed_resource_id)
    WHERE committed_resource_id IS NOT NULL;

CREATE TABLE ward_round_artifact_links (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    ward_round_id uuid NOT NULL REFERENCES ward_rounds(id) ON DELETE CASCADE,
    action_id uuid REFERENCES ward_round_actions(id) ON DELETE SET NULL,
    patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    admission_case_id uuid NOT NULL REFERENCES admission_cases(id) ON DELETE RESTRICT,
    resource_type text NOT NULL,
    resource_id uuid NOT NULL,
    title text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (ward_round_id, resource_type, resource_id)
);

CREATE INDEX ward_round_artifact_links_patient_time_idx
    ON ward_round_artifact_links (facility_id, patient_id, created_at DESC, id);

CREATE INDEX ward_round_artifact_links_round_idx
    ON ward_round_artifact_links (ward_round_id, created_at, id);
