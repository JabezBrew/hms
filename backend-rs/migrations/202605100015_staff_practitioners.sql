CREATE TABLE staff_profiles (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    user_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    employee_id text NOT NULL,
    department text NOT NULL,
    position text NOT NULL,
    hire_date date NOT NULL,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (facility_id, employee_id)
);

CREATE INDEX staff_profiles_facility_created_idx
    ON staff_profiles (facility_id, created_at, id);

CREATE INDEX staff_profiles_facility_department_idx
    ON staff_profiles (facility_id, department, created_at, id);

CREATE TABLE practitioner_profiles (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    staff_id uuid NOT NULL UNIQUE REFERENCES staff_profiles(id) ON DELETE CASCADE,
    license_number text NOT NULL,
    specialization text NOT NULL,
    qualification text NOT NULL,
    fhir_practitioner_id text,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (facility_id, license_number)
);

CREATE INDEX practitioner_profiles_facility_created_idx
    ON practitioner_profiles (facility_id, created_at, id);

CREATE INDEX practitioner_profiles_facility_specialization_idx
    ON practitioner_profiles (facility_id, specialization, created_at, id);
