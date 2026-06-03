CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS insurance_providers (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    code text NOT NULL,
    name text NOT NULL,
    payer_type text NOT NULL DEFAULT 'commercial',
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (facility_id, code)
);

CREATE TABLE IF NOT EXISTS insurance_plans (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    provider_id uuid NOT NULL REFERENCES insurance_providers(id) ON DELETE RESTRICT,
    code text NOT NULL,
    name text NOT NULL,
    coverage_percentage integer NOT NULL DEFAULT 100,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (facility_id, code)
);

CREATE TABLE IF NOT EXISTS patient_insurances (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    plan_id uuid NOT NULL REFERENCES insurance_plans(id) ON DELETE RESTRICT,
    policy_number text NOT NULL,
    member_id text,
    subscriber_number text,
    valid_from date NOT NULL,
    valid_until date,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (facility_id, policy_number)
);

CREATE INDEX IF NOT EXISTS insurance_providers_facility_active_created_idx
    ON insurance_providers (facility_id, is_active, created_at DESC, id);

CREATE INDEX IF NOT EXISTS insurance_providers_name_search_trgm_idx
    ON insurance_providers USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS insurance_providers_code_search_trgm_idx
    ON insurance_providers USING gin (code gin_trgm_ops);

CREATE INDEX IF NOT EXISTS insurance_providers_payer_type_search_trgm_idx
    ON insurance_providers USING gin (payer_type gin_trgm_ops);

CREATE INDEX IF NOT EXISTS insurance_plans_facility_provider_created_idx
    ON insurance_plans (facility_id, provider_id, created_at DESC, id);

CREATE INDEX IF NOT EXISTS insurance_plans_name_search_trgm_idx
    ON insurance_plans USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS insurance_plans_code_search_trgm_idx
    ON insurance_plans USING gin (code gin_trgm_ops);

CREATE INDEX IF NOT EXISTS patient_insurances_facility_patient_created_idx
    ON patient_insurances (facility_id, patient_id, created_at DESC, id);

CREATE INDEX IF NOT EXISTS patient_insurances_facility_active_created_idx
    ON patient_insurances (facility_id, is_active, created_at DESC, id);

CREATE INDEX IF NOT EXISTS patient_insurances_policy_search_trgm_idx
    ON patient_insurances USING gin (policy_number gin_trgm_ops);

CREATE INDEX IF NOT EXISTS patient_insurances_member_search_trgm_idx
    ON patient_insurances USING gin (member_id gin_trgm_ops);

CREATE INDEX IF NOT EXISTS patient_insurances_subscriber_search_trgm_idx
    ON patient_insurances USING gin (subscriber_number gin_trgm_ops);
