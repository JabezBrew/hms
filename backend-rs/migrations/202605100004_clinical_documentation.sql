CREATE TABLE clinical_note_templates (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    title text NOT NULL,
    note_type text NOT NULL,
    body_template text NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX clinical_note_templates_facility_type_idx
    ON clinical_note_templates (facility_id, note_type, is_active, title);

CREATE TABLE clinical_notes (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    encounter_id uuid REFERENCES encounters(id) ON DELETE SET NULL,
    note_type text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    status text NOT NULL,
    version bigint NOT NULL DEFAULT 1,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX clinical_notes_patient_time_idx
    ON clinical_notes (facility_id, patient_id, updated_at DESC, id);

CREATE TABLE clinical_note_versions (
    id uuid PRIMARY KEY,
    note_id uuid NOT NULL REFERENCES clinical_notes(id) ON DELETE CASCADE,
    version bigint NOT NULL,
    body text NOT NULL,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (note_id, version)
);

CREATE INDEX clinical_note_versions_note_idx
    ON clinical_note_versions (note_id, version DESC);

CREATE TABLE patient_problems (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    label text NOT NULL,
    status text NOT NULL,
    onset_date date,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX patient_problems_patient_status_idx
    ON patient_problems (facility_id, patient_id, status, created_at DESC, id);

CREATE TABLE patient_allergies (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    substance text NOT NULL,
    reaction text,
    severity text NOT NULL,
    status text NOT NULL,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX patient_allergies_patient_status_idx
    ON patient_allergies (facility_id, patient_id, status, created_at DESC, id);

CREATE TABLE prescriptions (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    medication_name text NOT NULL,
    dose text NOT NULL,
    frequency text NOT NULL,
    status text NOT NULL,
    prescribed_at timestamptz NOT NULL DEFAULT now(),
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX prescriptions_patient_status_idx
    ON prescriptions (facility_id, patient_id, status, prescribed_at DESC, id);

CREATE TABLE chart_entries (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    entry_type text NOT NULL,
    measured_at timestamptz NOT NULL,
    value text NOT NULL,
    unit text,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX chart_entries_patient_type_time_idx
    ON chart_entries (facility_id, patient_id, entry_type, measured_at DESC, id);
