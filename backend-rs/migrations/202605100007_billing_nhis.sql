CREATE TABLE service_catalog (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    code text NOT NULL,
    name text NOT NULL,
    service_kind text NOT NULL,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (facility_id, code)
);

CREATE INDEX service_catalog_facility_active_idx
    ON service_catalog (facility_id, active, code);

CREATE TABLE service_prices (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    service_id uuid NOT NULL REFERENCES service_catalog(id) ON DELETE RESTRICT,
    amount_minor bigint NOT NULL,
    currency text NOT NULL DEFAULT 'GHS',
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (facility_id, service_id, currency)
);

CREATE INDEX service_prices_facility_active_idx
    ON service_prices (facility_id, active, service_id);

CREATE TABLE billing_rules (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    code text NOT NULL,
    name text NOT NULL,
    rule_type text NOT NULL,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (facility_id, code)
);

CREATE TABLE cash_drawers (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    code text NOT NULL,
    name text NOT NULL,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (facility_id, code)
);

CREATE TABLE cash_sessions (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    drawer_id uuid NOT NULL REFERENCES cash_drawers(id) ON DELETE RESTRICT,
    opened_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    closed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    status text NOT NULL,
    opening_float_minor bigint NOT NULL,
    counted_cash_minor bigint,
    variance_minor bigint,
    currency text NOT NULL DEFAULT 'GHS',
    opened_at timestamptz NOT NULL DEFAULT now(),
    closed_at timestamptz
);

CREATE INDEX cash_sessions_facility_time_idx
    ON cash_sessions (facility_id, opened_at DESC, id);

CREATE UNIQUE INDEX cash_sessions_one_open_drawer_idx
    ON cash_sessions (facility_id, drawer_id)
    WHERE status = 'open';

CREATE TABLE invoices (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    invoice_number text NOT NULL,
    status text NOT NULL,
    gross_amount_minor bigint NOT NULL,
    paid_amount_minor bigint NOT NULL DEFAULT 0,
    currency text NOT NULL DEFAULT 'GHS',
    issued_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    issued_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (facility_id, invoice_number)
);

CREATE INDEX invoices_facility_time_idx
    ON invoices (facility_id, issued_at DESC, id);

CREATE INDEX invoices_patient_time_idx
    ON invoices (facility_id, patient_id, issued_at DESC, id);

CREATE TABLE invoice_lines (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    service_price_id uuid NOT NULL REFERENCES service_prices(id) ON DELETE RESTRICT,
    description text NOT NULL,
    quantity bigint NOT NULL,
    unit_amount_minor bigint NOT NULL,
    line_amount_minor bigint NOT NULL,
    currency text NOT NULL DEFAULT 'GHS',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX invoice_lines_invoice_idx
    ON invoice_lines (facility_id, invoice_id);

CREATE TABLE payments (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    cash_session_id uuid REFERENCES cash_sessions(id) ON DELETE RESTRICT,
    receipt_number text NOT NULL,
    amount_minor bigint NOT NULL,
    currency text NOT NULL DEFAULT 'GHS',
    method text NOT NULL,
    status text NOT NULL,
    recorded_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    paid_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (facility_id, receipt_number)
);

CREATE INDEX payments_facility_time_idx
    ON payments (facility_id, paid_at DESC, id);

CREATE INDEX payments_invoice_idx
    ON payments (facility_id, invoice_id, paid_at DESC, id);

CREATE TABLE receipts (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
    invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    receipt_number text NOT NULL,
    amount_minor bigint NOT NULL,
    currency text NOT NULL DEFAULT 'GHS',
    issued_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (facility_id, receipt_number)
);

CREATE INDEX receipts_facility_time_idx
    ON receipts (facility_id, issued_at DESC, id);

CREATE TABLE nhis_claims (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    claim_number text NOT NULL,
    status text NOT NULL,
    amount_minor bigint NOT NULL,
    currency text NOT NULL DEFAULT 'GHS',
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (facility_id, invoice_id),
    UNIQUE (facility_id, claim_number)
);

CREATE INDEX nhis_claims_facility_time_idx
    ON nhis_claims (facility_id, created_at DESC, id);

CREATE INDEX nhis_claims_patient_time_idx
    ON nhis_claims (facility_id, patient_id, created_at DESC, id);

CREATE TABLE nhis_batches (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    batch_number text NOT NULL,
    status text NOT NULL,
    claim_count bigint NOT NULL,
    total_amount_minor bigint NOT NULL,
    currency text NOT NULL DEFAULT 'GHS',
    export_checksum text,
    exported_at timestamptz,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (facility_id, batch_number)
);

CREATE INDEX nhis_batches_facility_time_idx
    ON nhis_batches (facility_id, created_at DESC, id);

CREATE TABLE nhis_batch_claims (
    batch_id uuid NOT NULL REFERENCES nhis_batches(id) ON DELETE CASCADE,
    claim_id uuid NOT NULL REFERENCES nhis_claims(id) ON DELETE RESTRICT,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    PRIMARY KEY (batch_id, claim_id),
    UNIQUE (facility_id, claim_id)
);

CREATE INDEX nhis_batch_claims_claim_idx
    ON nhis_batch_claims (facility_id, claim_id);

CREATE TABLE remittance_imports (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    batch_id uuid NOT NULL REFERENCES nhis_batches(id) ON DELETE RESTRICT,
    reference text NOT NULL,
    status text NOT NULL,
    total_paid_minor bigint NOT NULL,
    currency text NOT NULL DEFAULT 'GHS',
    imported_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    imported_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (facility_id, reference)
);

CREATE INDEX remittance_imports_facility_time_idx
    ON remittance_imports (facility_id, imported_at DESC, id);
