CREATE TABLE lab_tests (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    code text NOT NULL,
    name text NOT NULL,
    specimen_type text NOT NULL,
    result_unit text,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (facility_id, code)
);

CREATE INDEX lab_tests_facility_active_idx
    ON lab_tests (facility_id, is_active, code);

CREATE TABLE lab_panels (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    code text NOT NULL,
    name text NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (facility_id, code)
);

CREATE INDEX lab_panels_facility_active_idx
    ON lab_panels (facility_id, is_active, code);

CREATE TABLE lab_panel_tests (
    panel_id uuid NOT NULL REFERENCES lab_panels(id) ON DELETE CASCADE,
    test_id uuid NOT NULL REFERENCES lab_tests(id) ON DELETE RESTRICT,
    PRIMARY KEY (panel_id, test_id)
);

CREATE INDEX lab_panel_tests_test_idx
    ON lab_panel_tests (test_id);

CREATE TABLE lab_orders (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    priority text NOT NULL,
    status text NOT NULL,
    ordered_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    ordered_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX lab_orders_facility_time_idx
    ON lab_orders (facility_id, ordered_at DESC, id);

CREATE INDEX lab_orders_patient_time_idx
    ON lab_orders (facility_id, patient_id, ordered_at DESC, id);

CREATE TABLE lab_order_tests (
    order_id uuid NOT NULL REFERENCES lab_orders(id) ON DELETE CASCADE,
    test_id uuid NOT NULL REFERENCES lab_tests(id) ON DELETE RESTRICT,
    PRIMARY KEY (order_id, test_id)
);

CREATE INDEX lab_order_tests_test_idx
    ON lab_order_tests (test_id);

CREATE TABLE lab_specimens (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    order_id uuid NOT NULL REFERENCES lab_orders(id) ON DELETE CASCADE,
    patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    specimen_type text NOT NULL,
    status text NOT NULL,
    collected_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    collected_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX lab_specimens_facility_time_idx
    ON lab_specimens (facility_id, collected_at DESC, id);

CREATE INDEX lab_specimens_order_idx
    ON lab_specimens (order_id);

CREATE TABLE lab_results (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    order_id uuid NOT NULL REFERENCES lab_orders(id) ON DELETE CASCADE,
    specimen_id uuid NOT NULL REFERENCES lab_specimens(id) ON DELETE CASCADE,
    patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    test_id uuid NOT NULL REFERENCES lab_tests(id) ON DELETE RESTRICT,
    value text NOT NULL,
    unit text,
    status text NOT NULL,
    entered_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    entered_at timestamptz NOT NULL DEFAULT now(),
    verified_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    verified_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (specimen_id, test_id)
);

CREATE INDEX lab_results_facility_time_idx
    ON lab_results (facility_id, entered_at DESC, id);

CREATE INDEX lab_results_order_idx
    ON lab_results (order_id);

CREATE INDEX lab_results_patient_time_idx
    ON lab_results (facility_id, patient_id, entered_at DESC, id);
