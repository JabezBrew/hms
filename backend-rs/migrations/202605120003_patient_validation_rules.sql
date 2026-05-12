CREATE TABLE patient_registration_validation_rules (
    id UUID PRIMARY KEY,
    facility_id UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
    field_name VARCHAR(100) NOT NULL,
    validation_regex VARCHAR(255),
    validation_message VARCHAR(255) NOT NULL,
    is_required BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (facility_id, field_name)
);

CREATE INDEX patient_registration_validation_rules_facility_active_idx
    ON patient_registration_validation_rules (facility_id, field_name)
    WHERE is_active = TRUE;
