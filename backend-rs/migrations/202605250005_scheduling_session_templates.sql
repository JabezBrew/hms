CREATE TABLE clinic_session_templates (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    clinic_id uuid REFERENCES clinics(id) ON DELETE SET NULL,
    service_code text,
    practitioner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    owner_type text NOT NULL,
    owner_id uuid,
    name text NOT NULL,
    mode text NOT NULL,
    weekdays smallint[] NOT NULL,
    starts_on date NOT NULL,
    ends_on date,
    start_time time NOT NULL,
    end_time time NOT NULL,
    slot_minutes integer,
    capacity integer NOT NULL DEFAULT 1,
    allow_overbooking boolean NOT NULL DEFAULT false,
    overbook_limit integer NOT NULL DEFAULT 0,
    is_active boolean NOT NULL DEFAULT true,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (end_time > start_time),
    CHECK (ends_on IS NULL OR ends_on >= starts_on),
    CHECK (capacity > 0),
    CHECK (overbook_limit >= 0),
    CHECK (slot_minutes IS NULL OR slot_minutes > 0),
    CHECK (mode IN ('fixed_slot', 'capacity_block')),
    CHECK (owner_type IN ('facility', 'practitioner', 'team', 'clinic', 'service', 'department', 'resource')),
    CHECK (array_length(weekdays, 1) BETWEEN 1 AND 7),
    CHECK (0 < ALL(weekdays) AND 8 > ALL(weekdays))
);

CREATE INDEX clinic_session_templates_facility_active_idx
    ON clinic_session_templates (facility_id, starts_on, id)
    WHERE is_active = true;

CREATE INDEX clinic_session_templates_facility_clinic_idx
    ON clinic_session_templates (facility_id, clinic_id, starts_on, id)
    WHERE is_active = true AND clinic_id IS NOT NULL;

CREATE INDEX clinic_session_templates_facility_practitioner_idx
    ON clinic_session_templates (facility_id, practitioner_user_id, starts_on, id)
    WHERE is_active = true AND practitioner_user_id IS NOT NULL;

CREATE TABLE clinic_session_template_appointment_types (
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    clinic_session_template_id uuid NOT NULL REFERENCES clinic_session_templates(id) ON DELETE CASCADE,
    appointment_type_id uuid NOT NULL REFERENCES appointment_types(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (clinic_session_template_id, appointment_type_id)
);

ALTER TABLE clinic_sessions
    ADD COLUMN source_template_id uuid REFERENCES clinic_session_templates(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX clinic_sessions_template_start_unique_idx
    ON clinic_sessions (facility_id, source_template_id, starts_at)
    WHERE source_template_id IS NOT NULL;
