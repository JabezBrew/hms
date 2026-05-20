CREATE TABLE inventory_categories (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    code text NOT NULL,
    name text NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (facility_id, code)
);

CREATE TABLE inventory_items (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    category_id uuid NOT NULL REFERENCES inventory_categories(id) ON DELETE RESTRICT,
    code text NOT NULL,
    name text NOT NULL,
    item_type text NOT NULL,
    unit text NOT NULL,
    controlled boolean NOT NULL DEFAULT false,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (facility_id, code)
);

CREATE INDEX inventory_items_facility_active_idx
    ON inventory_items (facility_id, is_active, code);

CREATE TABLE storage_locations (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    code text NOT NULL,
    name text NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (facility_id, code)
);

CREATE TABLE stock_batches (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
    location_id uuid NOT NULL REFERENCES storage_locations(id) ON DELETE RESTRICT,
    batch_number text NOT NULL,
    expires_on date,
    quantity_on_hand bigint NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX stock_batches_facility_time_idx
    ON stock_batches (facility_id, received_at DESC, id);

CREATE INDEX stock_batches_item_location_idx
    ON stock_batches (facility_id, item_id, location_id, expires_on, id);

CREATE TABLE stock_movements (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
    batch_id uuid REFERENCES stock_batches(id) ON DELETE SET NULL,
    location_id uuid NOT NULL REFERENCES storage_locations(id) ON DELETE RESTRICT,
    movement_type text NOT NULL,
    quantity bigint NOT NULL,
    balance_after bigint NOT NULL,
    reason text NOT NULL,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX stock_movements_facility_time_idx
    ON stock_movements (facility_id, created_at DESC, id);

CREATE TABLE stock_transfers (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
    from_location_id uuid NOT NULL REFERENCES storage_locations(id) ON DELETE RESTRICT,
    to_location_id uuid NOT NULL REFERENCES storage_locations(id) ON DELETE RESTRICT,
    quantity bigint NOT NULL,
    status text NOT NULL,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX stock_transfers_facility_time_idx
    ON stock_transfers (facility_id, created_at DESC, id);

CREATE TABLE stock_requisitions (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    requesting_location_id uuid NOT NULL REFERENCES storage_locations(id) ON DELETE RESTRICT,
    status text NOT NULL,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX stock_requisitions_facility_time_idx
    ON stock_requisitions (facility_id, created_at DESC, id);

CREATE TABLE purchase_orders (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    supplier_name text NOT NULL,
    status text NOT NULL,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX purchase_orders_facility_time_idx
    ON purchase_orders (facility_id, created_at DESC, id);

CREATE TABLE goods_received_notes (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
    status text NOT NULL,
    received_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX goods_received_notes_facility_time_idx
    ON goods_received_notes (facility_id, received_at DESC, id);

CREATE TABLE controlled_substance_register (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
    location_id uuid NOT NULL REFERENCES storage_locations(id) ON DELETE RESTRICT,
    movement_type text NOT NULL,
    quantity_delta bigint NOT NULL,
    balance_after bigint NOT NULL,
    witness_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX controlled_substance_register_facility_time_idx
    ON controlled_substance_register (facility_id, created_at DESC, id);

CREATE TABLE pharmacy_dispenses (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
    location_id uuid NOT NULL REFERENCES storage_locations(id) ON DELETE RESTRICT,
    quantity bigint NOT NULL,
    status text NOT NULL,
    dispensed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    dispensed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pharmacy_dispenses_facility_time_idx
    ON pharmacy_dispenses (facility_id, dispensed_at DESC, id);

CREATE INDEX pharmacy_dispenses_patient_time_idx
    ON pharmacy_dispenses (facility_id, patient_id, dispensed_at DESC, id);
