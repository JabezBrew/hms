CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE nhis_service_mappings
    ADD COLUMN IF NOT EXISTS payer_id uuid REFERENCES insurance_providers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS nhis_service_mappings_facility_payer_effective_idx
    ON nhis_service_mappings (facility_id, payer_id, active, effective_from DESC, version_number DESC, id);

CREATE INDEX IF NOT EXISTS nhis_service_mappings_facility_payer_created_idx
    ON nhis_service_mappings (facility_id, payer_id, active, created_at DESC, id);

CREATE INDEX IF NOT EXISTS nhis_service_mappings_code_search_trgm_idx
    ON nhis_service_mappings USING gin (nhis_code gin_trgm_ops);

CREATE INDEX IF NOT EXISTS service_catalog_facility_created_idx
    ON service_catalog (facility_id, created_at DESC, id);

CREATE INDEX IF NOT EXISTS service_catalog_facility_active_created_idx
    ON service_catalog (facility_id, active, created_at DESC, id);

CREATE INDEX IF NOT EXISTS service_prices_facility_service_active_created_idx
    ON service_prices (facility_id, service_id, active, created_at DESC, id);

CREATE TABLE IF NOT EXISTS psp_payment_intents (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
    provider text NOT NULL DEFAULT 'hubtel',
    provider_reference text,
    client_reference text,
    status text NOT NULL,
    payment_method text NOT NULL DEFAULT 'mobile_money',
    amount_minor bigint NOT NULL,
    currency text NOT NULL DEFAULT 'GHS',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (facility_id, provider, provider_reference)
);

CREATE INDEX IF NOT EXISTS psp_payment_intents_facility_created_idx
    ON psp_payment_intents (facility_id, created_at DESC, id);

CREATE INDEX IF NOT EXISTS psp_payment_intents_facility_status_created_idx
    ON psp_payment_intents (facility_id, status, created_at DESC, id);

CREATE INDEX IF NOT EXISTS psp_payment_intents_provider_reference_trgm_idx
    ON psp_payment_intents USING gin (provider_reference gin_trgm_ops);

CREATE INDEX IF NOT EXISTS psp_payment_intents_client_reference_trgm_idx
    ON psp_payment_intents USING gin (client_reference gin_trgm_ops);

CREATE TABLE IF NOT EXISTS psp_settlement_batches (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    provider text NOT NULL DEFAULT 'hubtel',
    statement_date date,
    file_name text,
    status text NOT NULL DEFAULT 'pending',
    line_count bigint NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    imported_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS psp_settlement_batches_facility_created_idx
    ON psp_settlement_batches (facility_id, created_at DESC, id);

CREATE INDEX IF NOT EXISTS psp_settlement_batches_facility_status_created_idx
    ON psp_settlement_batches (facility_id, status, created_at DESC, id);

CREATE INDEX IF NOT EXISTS psp_settlement_batches_file_name_trgm_idx
    ON psp_settlement_batches USING gin (file_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS psp_settlement_batches_provider_trgm_idx
    ON psp_settlement_batches USING gin (provider gin_trgm_ops);

CREATE TABLE IF NOT EXISTS psp_settlement_lines (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    batch_id uuid NOT NULL REFERENCES psp_settlement_batches(id) ON DELETE CASCADE,
    payment_intent_id uuid REFERENCES psp_payment_intents(id) ON DELETE SET NULL,
    provider_reference text,
    client_reference text,
    amount_gross_minor bigint NOT NULL DEFAULT 0,
    fee_amount_minor bigint NOT NULL DEFAULT 0,
    amount_net_minor bigint NOT NULL DEFAULT 0,
    paid_at timestamptz,
    status text NOT NULL DEFAULT 'pending',
    match_status text NOT NULL DEFAULT 'unmatched',
    mismatch_reason text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS psp_settlement_lines_batch_created_idx
    ON psp_settlement_lines (facility_id, batch_id, created_at DESC, id);

CREATE INDEX IF NOT EXISTS psp_settlement_lines_match_status_idx
    ON psp_settlement_lines (facility_id, batch_id, match_status, created_at DESC, id);

CREATE INDEX IF NOT EXISTS psp_settlement_lines_provider_reference_trgm_idx
    ON psp_settlement_lines USING gin (provider_reference gin_trgm_ops);

CREATE INDEX IF NOT EXISTS psp_settlement_lines_client_reference_trgm_idx
    ON psp_settlement_lines USING gin (client_reference gin_trgm_ops);

CREATE TABLE IF NOT EXISTS remittance_import_lines (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    import_id uuid NOT NULL REFERENCES remittance_imports(id) ON DELETE CASCADE,
    claim_id uuid REFERENCES nhis_claims(id) ON DELETE SET NULL,
    invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
    claim_number text,
    invoice_number text,
    paid_amount_minor bigint NOT NULL DEFAULT 0,
    paid_date date,
    match_status text NOT NULL DEFAULT 'unmatched',
    mismatch_reason text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS remittance_import_lines_import_created_idx
    ON remittance_import_lines (facility_id, import_id, created_at DESC, id);

CREATE INDEX IF NOT EXISTS remittance_import_lines_match_status_idx
    ON remittance_import_lines (facility_id, import_id, match_status, created_at DESC, id);

CREATE INDEX IF NOT EXISTS remittance_import_lines_claim_number_trgm_idx
    ON remittance_import_lines USING gin (claim_number gin_trgm_ops);

CREATE INDEX IF NOT EXISTS remittance_import_lines_invoice_number_trgm_idx
    ON remittance_import_lines USING gin (invoice_number gin_trgm_ops);
