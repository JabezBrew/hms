-- Governed templates use a separate contract from historical metadata-only orders.
CREATE TABLE inventory_standing_order_templates (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
    requesting_location_id uuid NOT NULL REFERENCES storage_locations(id) ON DELETE RESTRICT,
    fulfilling_location_id uuid NOT NULL REFERENCES storage_locations(id) ON DELETE RESTRICT,
    frequency text NOT NULL CHECK (frequency IN ('daily', 'weekly', 'biweekly', 'monthly')),
    status text NOT NULL CHECK (status IN ('active', 'paused', 'cancelled')),
    next_run_on date NOT NULL,
    monthly_day integer CHECK (monthly_day BETWEEN 1 AND 31),
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    line_count integer NOT NULL CHECK (line_count BETWEEN 1 AND 100),
    notes text CHECK (octet_length(notes) <= 1000),
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (requesting_location_id <> fulfilling_location_id),
    CHECK ((frequency = 'monthly') = (monthly_day IS NOT NULL)),
    UNIQUE (facility_id, id)
);
CREATE INDEX standing_order_templates_facility_page_idx ON inventory_standing_order_templates (facility_id, created_at DESC, id DESC);
CREATE INDEX standing_order_templates_facility_due_idx ON inventory_standing_order_templates (facility_id, next_run_on, id) WHERE status = 'active';

CREATE TABLE inventory_standing_order_template_items (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL,
    template_id uuid NOT NULL,
    item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
    item_code text NOT NULL,
    item_name text NOT NULL,
    unit text NOT NULL,
    quantity bigint NOT NULL CHECK (quantity > 0),
    FOREIGN KEY (facility_id, template_id) REFERENCES inventory_standing_order_templates(facility_id, id) ON DELETE RESTRICT,
    UNIQUE (template_id, item_id)
);

ALTER TABLE stock_requisitions
    ADD COLUMN fulfilling_location_id uuid REFERENCES storage_locations(id) ON DELETE RESTRICT,
    ADD COLUMN line_count integer NOT NULL DEFAULT 0 CHECK (line_count BETWEEN 0 AND 100),
    ADD COLUMN approved_at timestamptz,
    ADD COLUMN approved_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN fulfilled_at timestamptz,
    ADD COLUMN fulfilled_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE stock_requisition_items (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    requisition_id uuid NOT NULL REFERENCES stock_requisitions(id) ON DELETE RESTRICT,
    item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
    item_code text NOT NULL,
    item_name text NOT NULL,
    unit text NOT NULL,
    quantity_requested bigint NOT NULL CHECK (quantity_requested > 0),
    quantity_issued bigint NOT NULL DEFAULT 0 CHECK (quantity_issued >= 0 AND quantity_issued <= quantity_requested),
    UNIQUE (requisition_id, item_id)
);
CREATE INDEX stock_requisition_items_facility_req_idx ON stock_requisition_items (facility_id, requisition_id, id);

CREATE TABLE inventory_standing_order_runs (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL,
    template_id uuid NOT NULL,
    template_version bigint NOT NULL CHECK (template_version > 0),
    scheduled_for date NOT NULL,
    requisition_id uuid NOT NULL UNIQUE REFERENCES stock_requisitions(id) ON DELETE RESTRICT,
    generated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    generated_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (facility_id, template_id) REFERENCES inventory_standing_order_templates(facility_id, id) ON DELETE RESTRICT,
    UNIQUE (facility_id, template_id, scheduled_for)
);
CREATE INDEX standing_order_runs_facility_template_idx ON inventory_standing_order_runs (facility_id, template_id, generated_at DESC, id DESC);

-- Each source allocation has a matching destination lot and paired movement.
CREATE TABLE stock_requisition_issue_allocations (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    requisition_id uuid NOT NULL REFERENCES stock_requisitions(id) ON DELETE RESTRICT,
    requisition_item_id uuid NOT NULL REFERENCES stock_requisition_items(id) ON DELETE RESTRICT,
    source_batch_id uuid NOT NULL REFERENCES stock_batches(id) ON DELETE RESTRICT,
    destination_batch_id uuid NOT NULL REFERENCES stock_batches(id) ON DELETE RESTRICT,
    out_movement_id uuid NOT NULL UNIQUE REFERENCES stock_movements(id) ON DELETE RESTRICT,
    in_movement_id uuid NOT NULL UNIQUE REFERENCES stock_movements(id) ON DELETE RESTRICT,
    quantity bigint NOT NULL CHECK (quantity > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (source_batch_id <> destination_batch_id),
    UNIQUE (requisition_item_id, source_batch_id)
);
CREATE INDEX stock_requisition_issue_allocations_request_idx ON stock_requisition_issue_allocations (facility_id,requisition_id,id);
CREATE INDEX stock_batches_available_fefo_idx ON stock_batches (facility_id,item_id,location_id,expires_on,received_at,id) WHERE quantity_on_hand > 0;
