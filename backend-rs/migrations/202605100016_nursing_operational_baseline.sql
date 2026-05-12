CREATE TABLE patient_vitals (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    admission_case_id uuid NOT NULL REFERENCES admission_cases(id) ON DELETE CASCADE,
    patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL,
    temperature_c real,
    systolic_bp integer,
    diastolic_bp integer,
    pulse integer,
    respiratory_rate integer,
    oxygen_saturation integer,
    recorded_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX patient_vitals_facility_recorded_idx
    ON patient_vitals (facility_id, recorded_at, id);

CREATE INDEX patient_vitals_admission_recorded_idx
    ON patient_vitals (admission_case_id, recorded_at, id);

CREATE TABLE nursing_alerts (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    admission_case_id uuid NOT NULL REFERENCES admission_cases(id) ON DELETE CASCADE,
    patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    severity text NOT NULL,
    title text NOT NULL,
    status text NOT NULL,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    acknowledged_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    acknowledged_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX nursing_alerts_facility_status_time_idx
    ON nursing_alerts (facility_id, status, created_at, id);

CREATE TABLE monitoring_events (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    admission_case_id uuid NOT NULL REFERENCES admission_cases(id) ON DELETE CASCADE,
    patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    event_kind text NOT NULL,
    summary text NOT NULL,
    recorded_at timestamptz NOT NULL,
    recorded_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX monitoring_events_facility_recorded_idx
    ON monitoring_events (facility_id, recorded_at, id);

CREATE INDEX monitoring_events_admission_recorded_idx
    ON monitoring_events (admission_case_id, recorded_at, id);

CREATE TABLE fluid_balance_entries (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    admission_case_id uuid NOT NULL REFERENCES admission_cases(id) ON DELETE CASCADE,
    patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    recorded_at timestamptz NOT NULL,
    intake_ml integer NOT NULL,
    output_ml integer NOT NULL,
    recorded_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fluid_balance_non_negative CHECK (intake_ml >= 0 AND output_ml >= 0)
);

CREATE INDEX fluid_balance_facility_recorded_idx
    ON fluid_balance_entries (facility_id, recorded_at, id);

CREATE INDEX fluid_balance_admission_recorded_idx
    ON fluid_balance_entries (admission_case_id, recorded_at, id);

CREATE TABLE ward_stock_requests (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    ward_id uuid NOT NULL REFERENCES wards(id) ON DELETE RESTRICT,
    requested_item text NOT NULL,
    quantity_requested integer NOT NULL,
    status text NOT NULL,
    requested_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    approved_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    fulfilled_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    requested_at timestamptz NOT NULL DEFAULT now(),
    approved_at timestamptz,
    fulfilled_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ward_stock_quantity_positive CHECK (quantity_requested > 0)
);

CREATE INDEX ward_stock_requests_facility_status_time_idx
    ON ward_stock_requests (facility_id, status, requested_at, id);

CREATE INDEX ward_stock_requests_ward_status_time_idx
    ON ward_stock_requests (ward_id, status, requested_at, id);
