CREATE TABLE ward_sections (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    ward_id uuid NOT NULL REFERENCES wards(id) ON DELETE RESTRICT,
    code text NOT NULL,
    name text NOT NULL,
    status text NOT NULL,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (ward_id, code)
);

CREATE INDEX ward_sections_ward_status_idx
    ON ward_sections (ward_id, status, created_at, id);

ALTER TABLE beds
    ADD COLUMN section_id uuid REFERENCES ward_sections(id) ON DELETE SET NULL,
    ADD COLUMN created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX beds_section_status_idx
    ON beds (section_id, status, created_at, id);
