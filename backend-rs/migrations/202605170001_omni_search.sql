CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE search_documents (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    resource_type text NOT NULL,
    resource_id uuid NOT NULL,
    patient_id uuid REFERENCES patients(id) ON DELETE CASCADE,
    patient_code text,
    patient_name text,
    patient_date_of_birth date,
    title text NOT NULL,
    subtitle text,
    route_path text NOT NULL,
    status_label text,
    feature_key text,
    permission_code text NOT NULL,
    requires_patient_demographics boolean NOT NULL DEFAULT false,
    search_text text NOT NULL,
    rank_boost integer NOT NULL DEFAULT 0,
    source_updated_at timestamptz,
    occurred_at timestamptz,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    is_active boolean NOT NULL DEFAULT true,
    indexed_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (facility_id, resource_type, resource_id)
);

CREATE INDEX search_documents_facility_type_active_idx
    ON search_documents (facility_id, resource_type, is_active, source_updated_at DESC, resource_id);

CREATE INDEX search_documents_permission_feature_idx
    ON search_documents (facility_id, permission_code, feature_key, resource_type)
    WHERE is_active = true;

CREATE INDEX search_documents_patient_idx
    ON search_documents (facility_id, patient_id, resource_type, source_updated_at DESC)
    WHERE patient_id IS NOT NULL AND is_active = true;

CREATE INDEX search_documents_fts_idx
    ON search_documents USING gin (to_tsvector('simple', search_text))
    WHERE is_active = true;

CREATE INDEX search_documents_trgm_idx
    ON search_documents USING gin (lower(search_text) gin_trgm_ops)
    WHERE is_active = true;

CREATE TABLE search_index_status (
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
    resource_type text NOT NULL,
    status text NOT NULL,
    indexed_count bigint NOT NULL DEFAULT 0,
    last_backfilled_at timestamptz,
    last_error text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (facility_id, resource_type)
);

CREATE INDEX search_index_status_facility_status_idx
    ON search_index_status (facility_id, status, resource_type);
