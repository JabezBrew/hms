CREATE TABLE clinic_sessions (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    clinic_id uuid REFERENCES clinics(id) ON DELETE SET NULL,
    service_code text,
    practitioner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    owner_type text NOT NULL,
    owner_id uuid,
    name text NOT NULL,
    mode text NOT NULL,
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    slot_minutes integer,
    capacity integer NOT NULL DEFAULT 1,
    allow_overbooking boolean NOT NULL DEFAULT false,
    overbook_limit integer NOT NULL DEFAULT 0,
    is_active boolean NOT NULL DEFAULT true,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (ends_at > starts_at),
    CHECK (capacity > 0),
    CHECK (overbook_limit >= 0),
    CHECK (slot_minutes IS NULL OR slot_minutes > 0),
    CHECK (mode IN ('fixed_slot', 'capacity_block')),
    CHECK (owner_type IN ('practitioner', 'team', 'clinic', 'service', 'department'))
);

CREATE INDEX clinic_sessions_facility_time_idx
    ON clinic_sessions (facility_id, starts_at, id)
    WHERE is_active = true;

CREATE INDEX clinic_sessions_facility_clinic_idx
    ON clinic_sessions (facility_id, clinic_id, starts_at, id)
    WHERE is_active = true;

CREATE TABLE appointment_types (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    code text NOT NULL,
    name text NOT NULL,
    default_duration_minutes integer NOT NULL DEFAULT 30,
    is_active boolean NOT NULL DEFAULT true,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (facility_id, code),
    CHECK (default_duration_minutes > 0)
);

CREATE TABLE clinic_session_appointment_types (
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    clinic_session_id uuid NOT NULL REFERENCES clinic_sessions(id) ON DELETE CASCADE,
    appointment_type_id uuid NOT NULL REFERENCES appointment_types(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (clinic_session_id, appointment_type_id)
);

CREATE TABLE appointment_series (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    patient_id uuid NOT NULL REFERENCES patients(id) ON DELETE RESTRICT,
    repeat_rule text,
    selected_dates jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE appointment_blocked_times (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    scope text NOT NULL,
    clinic_session_id uuid REFERENCES clinic_sessions(id) ON DELETE CASCADE,
    practitioner_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    starts_at timestamptz NOT NULL,
    ends_at timestamptz NOT NULL,
    reason text NOT NULL,
    created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (ends_at > starts_at),
    CHECK (scope IN ('session', 'practitioner')),
    CHECK (
        (scope = 'session' AND clinic_session_id IS NOT NULL)
        OR (scope = 'practitioner' AND practitioner_user_id IS NOT NULL)
    )
);

CREATE INDEX appointment_blocked_times_session_idx
    ON appointment_blocked_times (facility_id, clinic_session_id, starts_at, ends_at)
    WHERE clinic_session_id IS NOT NULL;

CREATE INDEX appointment_blocked_times_practitioner_idx
    ON appointment_blocked_times (facility_id, practitioner_user_id, starts_at, ends_at)
    WHERE practitioner_user_id IS NOT NULL;

ALTER TABLE appointments
    ADD COLUMN clinic_session_id uuid REFERENCES clinic_sessions(id) ON DELETE SET NULL,
    ADD COLUMN appointment_type_id uuid REFERENCES appointment_types(id) ON DELETE SET NULL,
    ADD COLUMN practitioner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN series_id uuid REFERENCES appointment_series(id) ON DELETE SET NULL,
    ADD COLUMN cancellation_reason text,
    ADD COLUMN cancelled_at timestamptz,
    ADD COLUMN cancelled_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN overbook_reason text,
    ADD COLUMN overbooked_at timestamptz,
    ADD COLUMN overbooked_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX appointments_session_time_idx
    ON appointments (facility_id, clinic_session_id, starts_at, id)
    WHERE clinic_session_id IS NOT NULL;

CREATE INDEX appointments_practitioner_time_idx
    ON appointments (facility_id, practitioner_user_id, starts_at, id)
    WHERE practitioner_user_id IS NOT NULL;

CREATE TABLE appointment_history (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
    event_type text NOT NULL,
    actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    reason text,
    previous_starts_at timestamptz,
    previous_ends_at timestamptz,
    new_starts_at timestamptz,
    new_ends_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX appointment_history_appointment_idx
    ON appointment_history (facility_id, appointment_id, created_at, id);
