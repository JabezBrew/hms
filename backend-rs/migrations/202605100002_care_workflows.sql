CREATE TABLE clinics (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    code text NOT NULL,
    name text NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (facility_id, code)
);

CREATE TABLE appointments (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    clinic_id uuid REFERENCES clinics(id) ON DELETE SET NULL,
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    status text NOT NULL,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (ends_at > starts_at)
);

CREATE INDEX appointments_facility_start_idx
    ON appointments (facility_id, starts_at, id);

CREATE INDEX appointments_patient_idx
    ON appointments (facility_id, patient_id, starts_at DESC);

CREATE TABLE visits (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    appointment_id uuid REFERENCES appointments(id) ON DELETE SET NULL,
    clinic_id uuid REFERENCES clinics(id) ON DELETE SET NULL,
    status text NOT NULL,
    checked_in_at timestamptz NOT NULL DEFAULT now(),
    called_at timestamptz,
    consultation_started_at timestamptz,
    checked_out_at timestamptz,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX visits_facility_status_time_idx
    ON visits (facility_id, status, checked_in_at, id);

CREATE INDEX visits_patient_idx
    ON visits (facility_id, patient_id, checked_in_at DESC);

CREATE TABLE triage_queue (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    visit_id uuid NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
    patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    acuity text NOT NULL,
    status text NOT NULL,
    assigned_to_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    assigned_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (visit_id)
);

CREATE INDEX triage_facility_status_time_idx
    ON triage_queue (facility_id, status, created_at, id);

CREATE TABLE encounters (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    visit_id uuid REFERENCES visits(id) ON DELETE SET NULL,
    encounter_type text NOT NULL,
    status text NOT NULL,
    started_at timestamptz NOT NULL DEFAULT now(),
    ended_at timestamptz,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX encounters_facility_status_time_idx
    ON encounters (facility_id, status, started_at, id);

CREATE INDEX encounters_patient_idx
    ON encounters (facility_id, patient_id, started_at DESC);

CREATE TABLE encounter_care_team_assignments (
    id uuid PRIMARY KEY,
    encounter_id uuid NOT NULL REFERENCES encounters(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    role text NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (encounter_id, user_id, role)
);

CREATE INDEX encounter_care_team_active_idx
    ON encounter_care_team_assignments (encounter_id, is_active);
