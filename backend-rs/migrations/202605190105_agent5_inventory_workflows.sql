ALTER TABLE stock_requisitions
    ADD COLUMN source_type text,
    ADD COLUMN source_id uuid;

CREATE INDEX stock_requisitions_facility_source_idx
    ON stock_requisitions (facility_id, source_type, source_id)
    WHERE source_type IS NOT NULL AND source_id IS NOT NULL;

CREATE TABLE controlled_substance_discrepancies (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    register_entry_id uuid NOT NULL REFERENCES controlled_substance_register(id) ON DELETE RESTRICT,
    category text NOT NULL,
    expected_balance bigint NOT NULL,
    actual_count bigint NOT NULL,
    quantity_delta bigint NOT NULL,
    reason text NOT NULL,
    status text NOT NULL DEFAULT 'logged',
    severity text NOT NULL DEFAULT 'high',
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX controlled_discrepancies_facility_time_idx
    ON controlled_substance_discrepancies (facility_id, created_at DESC, id);

CREATE INDEX controlled_discrepancies_register_idx
    ON controlled_substance_discrepancies (facility_id, register_entry_id);

CREATE TABLE inventory_item_catalog_versions (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
    effective_from date NOT NULL,
    effective_to date,
    code text NOT NULL,
    name text NOT NULL,
    unit text NOT NULL,
    reason text NOT NULL,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
    UNIQUE (facility_id, item_id, effective_from)
);

CREATE INDEX inventory_catalog_versions_item_effective_idx
    ON inventory_item_catalog_versions (facility_id, item_id, effective_from DESC, id);

CREATE TABLE inventory_standing_orders (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    requesting_location_id uuid NOT NULL REFERENCES storage_locations(id) ON DELETE RESTRICT,
    frequency text NOT NULL,
    status text NOT NULL,
    next_run_on date NOT NULL,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX inventory_standing_orders_facility_due_idx
    ON inventory_standing_orders (facility_id, status, next_run_on, id);

CREATE TABLE supply_request_dispenses (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    requisition_id uuid NOT NULL REFERENCES stock_requisitions(id) ON DELETE RESTRICT,
    status text NOT NULL,
    line_count bigint NOT NULL,
    dispensed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    dispensed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX supply_request_dispenses_facility_time_idx
    ON supply_request_dispenses (facility_id, dispensed_at DESC, id);

CREATE TABLE stock_check_queue (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    location_id uuid NOT NULL REFERENCES storage_locations(id) ON DELETE RESTRICT,
    status text NOT NULL,
    reason text NOT NULL,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    started_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    completed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    cancelled_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    completed_at timestamptz,
    cancelled_at timestamptz
);

CREATE INDEX stock_check_queue_facility_status_time_idx
    ON stock_check_queue (facility_id, status, created_at DESC, id);
