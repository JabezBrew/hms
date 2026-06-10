CREATE TABLE identifier_sequences (
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
    identifier_type text NOT NULL,
    year integer NOT NULL,
    next_number bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (facility_id, identifier_type, year),
    CHECK (next_number > 0)
);
