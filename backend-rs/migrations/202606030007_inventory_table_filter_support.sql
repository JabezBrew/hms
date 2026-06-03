ALTER TABLE storage_locations
    ADD COLUMN IF NOT EXISTS location_type text NOT NULL DEFAULT 'store',
    ADD COLUMN IF NOT EXISTS temperature_zone text NOT NULL DEFAULT 'ambient';

ALTER TABLE stock_requisitions
    ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal';

UPDATE storage_locations
SET location_type = CASE
        WHEN code = 'PHARM' OR lower(name) LIKE '%pharmacy%' THEN 'pharmacy'
        WHEN lower(name) LIKE '%ward%' THEN 'ward'
        WHEN lower(name) LIKE '%warehouse%' THEN 'warehouse'
        WHEN lower(name) LIKE '%department%' THEN 'department'
        ELSE 'store'
    END,
    temperature_zone = CASE
        WHEN lower(name) LIKE '%cold%' THEN 'cold'
        WHEN lower(name) LIKE '%frozen%' THEN 'frozen'
        WHEN lower(name) LIKE '%controlled%' THEN 'controlled'
        ELSE 'ambient'
    END
WHERE location_type = 'store'
  AND temperature_zone = 'ambient';

CREATE INDEX IF NOT EXISTS storage_locations_facility_type_created_idx
    ON storage_locations (facility_id, location_type, created_at, id);

CREATE INDEX IF NOT EXISTS storage_locations_facility_temp_created_idx
    ON storage_locations (facility_id, temperature_zone, created_at, id);

CREATE INDEX IF NOT EXISTS storage_locations_search_trgm_idx
    ON storage_locations USING gin (lower(code || ' ' || name) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS purchase_orders_facility_status_time_idx
    ON purchase_orders (facility_id, status, created_at DESC, id);

CREATE INDEX IF NOT EXISTS purchase_orders_supplier_search_trgm_idx
    ON purchase_orders USING gin (lower(supplier_name) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS goods_received_notes_facility_status_time_idx
    ON goods_received_notes (facility_id, status, received_at DESC, id);

CREATE INDEX IF NOT EXISTS stock_transfers_facility_status_time_idx
    ON stock_transfers (facility_id, status, created_at DESC, id);

CREATE INDEX IF NOT EXISTS stock_transfers_facility_from_time_idx
    ON stock_transfers (facility_id, from_location_id, created_at DESC, id);

CREATE INDEX IF NOT EXISTS stock_transfers_facility_to_time_idx
    ON stock_transfers (facility_id, to_location_id, created_at DESC, id);

CREATE INDEX IF NOT EXISTS stock_requisitions_facility_status_time_idx
    ON stock_requisitions (facility_id, status, created_at DESC, id);

CREATE INDEX IF NOT EXISTS stock_requisitions_facility_location_time_idx
    ON stock_requisitions (facility_id, requesting_location_id, created_at DESC, id);

CREATE INDEX IF NOT EXISTS stock_requisitions_facility_priority_time_idx
    ON stock_requisitions (facility_id, priority, created_at DESC, id);

CREATE INDEX IF NOT EXISTS inventory_standing_orders_facility_status_time_idx
    ON inventory_standing_orders (facility_id, status, created_at DESC, id);
