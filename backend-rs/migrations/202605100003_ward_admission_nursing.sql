CREATE TABLE wards (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    code text NOT NULL,
    name text NOT NULL,
    status text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (facility_id, code)
);

CREATE INDEX wards_facility_status_idx
    ON wards (facility_id, status, created_at, id);

CREATE TABLE beds (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    ward_id uuid NOT NULL REFERENCES wards(id) ON DELETE RESTRICT,
    bed_code text NOT NULL,
    status text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (ward_id, bed_code)
);

CREATE INDEX beds_ward_status_idx
    ON beds (ward_id, status, created_at, id);

CREATE TABLE admission_cases (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    ward_id uuid NOT NULL REFERENCES wards(id) ON DELETE RESTRICT,
    bed_id uuid REFERENCES beds(id) ON DELETE SET NULL,
    status text NOT NULL,
    admitted_at timestamptz NOT NULL DEFAULT now(),
    discharged_at timestamptz,
    attending_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX admission_cases_one_active_patient_idx
    ON admission_cases (facility_id, patient_id)
    WHERE status IN ('admitted', 'discharge_pending');

CREATE INDEX admission_cases_ward_status_time_idx
    ON admission_cases (facility_id, ward_id, status, admitted_at, id);

CREATE TABLE discharge_cases (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    admission_case_id uuid NOT NULL REFERENCES admission_cases(id) ON DELETE CASCADE,
    patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    status text NOT NULL,
    requested_at timestamptz NOT NULL DEFAULT now(),
    discharged_at timestamptz,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (admission_case_id)
);

CREATE INDEX discharge_cases_facility_status_time_idx
    ON discharge_cases (facility_id, status, requested_at, id);

CREATE TABLE nursing_tasks (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    admission_case_id uuid NOT NULL REFERENCES admission_cases(id) ON DELETE CASCADE,
    patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    ward_id uuid NOT NULL REFERENCES wards(id) ON DELETE RESTRICT,
    task_type text NOT NULL,
    status text NOT NULL,
    due_at timestamptz NOT NULL,
    assigned_to_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    completed_at timestamptz,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX nursing_tasks_facility_status_due_idx
    ON nursing_tasks (facility_id, status, due_at, id);

CREATE INDEX nursing_tasks_admission_idx
    ON nursing_tasks (admission_case_id, status, due_at);

CREATE TABLE medication_administrations (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    admission_case_id uuid NOT NULL REFERENCES admission_cases(id) ON DELETE CASCADE,
    patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    medication_name text NOT NULL,
    scheduled_at timestamptz NOT NULL,
    administered_at timestamptz,
    status text NOT NULL,
    administered_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    witness_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX medication_administrations_facility_status_due_idx
    ON medication_administrations (facility_id, status, scheduled_at, id);

CREATE INDEX medication_administrations_admission_idx
    ON medication_administrations (admission_case_id, status, scheduled_at);

CREATE TABLE handoffs (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    ward_id uuid NOT NULL REFERENCES wards(id) ON DELETE RESTRICT,
    from_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    to_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    shift_label text NOT NULL,
    status text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX handoffs_facility_status_time_idx
    ON handoffs (facility_id, status, created_at, id);

CREATE TABLE treatment_sheets (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    admission_case_id uuid NOT NULL REFERENCES admission_cases(id) ON DELETE CASCADE,
    patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    sheet_date date NOT NULL,
    status text NOT NULL,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (admission_case_id, sheet_date)
);

CREATE INDEX treatment_sheets_facility_date_idx
    ON treatment_sheets (facility_id, sheet_date DESC, id);
