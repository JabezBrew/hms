CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS audit_events_event_type_search_trgm_idx
    ON audit_events USING gin (event_type gin_trgm_ops);

CREATE INDEX IF NOT EXISTS audit_events_resource_type_search_trgm_idx
    ON audit_events USING gin (resource_type gin_trgm_ops);

CREATE INDEX IF NOT EXISTS audit_events_resource_id_search_trgm_idx
    ON audit_events USING gin ((resource_id::text) gin_trgm_ops)
    WHERE resource_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS audit_events_request_id_search_trgm_idx
    ON audit_events USING gin (request_id gin_trgm_ops)
    WHERE request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS service_catalog_code_search_trgm_idx
    ON service_catalog USING gin (code gin_trgm_ops);

CREATE INDEX IF NOT EXISTS service_catalog_name_search_trgm_idx
    ON service_catalog USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS service_catalog_kind_search_trgm_idx
    ON service_catalog USING gin (service_kind gin_trgm_ops);
