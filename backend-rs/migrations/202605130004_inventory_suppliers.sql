CREATE TABLE inventory_suppliers (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    code text NOT NULL,
    name text NOT NULL,
    contact_name text,
    phone text,
    email text,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (facility_id, code)
);

CREATE INDEX inventory_suppliers_facility_active_created_idx
    ON inventory_suppliers (facility_id, is_active, created_at, id);

CREATE INDEX inventory_suppliers_facility_name_idx
    ON inventory_suppliers (facility_id, name);
