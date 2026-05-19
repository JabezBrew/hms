ALTER TABLE invoices
    ADD COLUMN locked_at timestamptz,
    ADD COLUMN locked_reason text,
    ADD COLUMN finalized_at timestamptz,
    ADD COLUMN finalized_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN finalized_approval_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN finalized_reauthorized_at timestamptz;

CREATE INDEX invoices_facility_locked_idx
    ON invoices (facility_id, locked_at DESC, id)
    WHERE locked_at IS NOT NULL;

CREATE TABLE payment_reversal_ledger (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
    invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    reversal_kind text NOT NULL,
    amount_minor bigint NOT NULL,
    currency text NOT NULL DEFAULT 'GHS',
    reason text NOT NULL,
    approved_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    recorded_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    reauthorized_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payment_reversal_ledger_payment_idx
    ON payment_reversal_ledger (facility_id, payment_id, created_at DESC, id);

CREATE TABLE nhis_service_mappings (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    service_id uuid NOT NULL REFERENCES service_catalog(id) ON DELETE RESTRICT,
    nhis_code text NOT NULL,
    version_number bigint NOT NULL,
    effective_from date NOT NULL,
    effective_until date,
    active boolean NOT NULL DEFAULT true,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (effective_until IS NULL OR effective_until > effective_from),
    UNIQUE (facility_id, service_id, version_number)
);

CREATE INDEX nhis_service_mappings_effective_idx
    ON nhis_service_mappings (facility_id, service_id, active, effective_from DESC, version_number DESC);

ALTER TABLE nhis_claims
    ADD COLUMN nhis_service_mapping_id uuid REFERENCES nhis_service_mappings(id) ON DELETE SET NULL,
    ADD COLUMN nhis_service_mapping_version bigint,
    ADD COLUMN nhis_service_code text,
    ADD COLUMN payer_receivable_minor bigint,
    ADD COLUMN patient_liability_minor bigint NOT NULL DEFAULT 0,
    ADD COLUMN written_off_minor bigint NOT NULL DEFAULT 0,
    ADD COLUMN reconciled_at timestamptz;

UPDATE nhis_claims
SET payer_receivable_minor = amount_minor
WHERE payer_receivable_minor IS NULL;

ALTER TABLE nhis_claims
    ALTER COLUMN payer_receivable_minor SET NOT NULL;

CREATE TABLE nhis_claim_ar_adjustments (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    claim_id uuid NOT NULL REFERENCES nhis_claims(id) ON DELETE RESTRICT,
    adjustment_kind text NOT NULL,
    amount_minor bigint NOT NULL,
    reason text NOT NULL,
    affects_patient_liability boolean NOT NULL DEFAULT false,
    recorded_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX nhis_claim_ar_adjustments_claim_idx
    ON nhis_claim_ar_adjustments (facility_id, claim_id, created_at DESC, id);

CREATE TABLE billing_discharge_clearances (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    cleared boolean NOT NULL,
    outstanding_invoice_count bigint NOT NULL,
    outstanding_amount_minor bigint NOT NULL,
    currency text NOT NULL DEFAULT 'GHS',
    reason text NOT NULL,
    recorded_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX billing_discharge_clearances_patient_idx
    ON billing_discharge_clearances (facility_id, patient_id, created_at DESC, id);
