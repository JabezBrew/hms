CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE deployment_profiles (
    code text PRIMARY KEY,
    label text NOT NULL,
    is_supported boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE deployment_profile_features (
    profile_code text NOT NULL REFERENCES deployment_profiles(code) ON DELETE CASCADE,
    feature_key text NOT NULL,
    enabled boolean NOT NULL DEFAULT true,
    PRIMARY KEY (profile_code, feature_key)
);

CREATE TABLE deployment_profile_permissions (
    profile_code text NOT NULL REFERENCES deployment_profiles(code) ON DELETE CASCADE,
    permission_code text NOT NULL,
    PRIMARY KEY (profile_code, permission_code)
);

CREATE TABLE facilities (
    id uuid PRIMARY KEY,
    code text NOT NULL UNIQUE,
    name text NOT NULL,
    deployment_profile text NOT NULL REFERENCES deployment_profiles(code),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    email text NOT NULL,
    display_name text NOT NULL,
    password_hash text NOT NULL,
    session_version bigint NOT NULL DEFAULT 1,
    permission_version bigint NOT NULL DEFAULT 1,
    password_change_required boolean NOT NULL DEFAULT false,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX users_facility_lower_email_key
    ON users (facility_id, lower(email));

CREATE TABLE user_permissions (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission_code text NOT NULL,
    PRIMARY KEY (user_id, permission_code)
);

CREATE TABLE user_features (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    feature_key text NOT NULL,
    PRIMARY KEY (user_id, feature_key)
);

CREATE TABLE user_patient_visibility (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    visibility text NOT NULL,
    PRIMARY KEY (user_id, visibility)
);

CREATE TABLE refresh_sessions (
    token_hash text PRIMARY KEY,
    session_id uuid NOT NULL UNIQUE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    session_version bigint NOT NULL,
    permission_version_at_issue bigint NOT NULL,
    csrf_token_hash text NOT NULL,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX refresh_sessions_user_active_idx
    ON refresh_sessions (user_id, expires_at)
    WHERE revoked_at IS NULL;

CREATE TABLE patients (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    patient_code text NOT NULL,
    first_name text NOT NULL,
    last_name text NOT NULL,
    date_of_birth date NOT NULL,
    sex text NOT NULL,
    status text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (facility_id, patient_code)
);

CREATE INDEX patients_facility_created_idx
    ON patients (facility_id, created_at, id);

CREATE INDEX patients_facility_status_idx
    ON patients (facility_id, status, created_at, id);

CREATE INDEX patients_search_trgm_idx
    ON patients USING gin (
        lower(patient_code || ' ' || first_name || ' ' || last_name) gin_trgm_ops
    );

CREATE TABLE patient_chronicle_read_models (
    patient_id uuid PRIMARY KEY REFERENCES patients(id) ON DELETE CASCADE,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    summary_status text NOT NULL DEFAULT 'empty',
    latest_event_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX patient_chronicle_facility_updated_idx
    ON patient_chronicle_read_models (facility_id, updated_at DESC, patient_id);

CREATE TABLE audit_events (
    id uuid PRIMARY KEY,
    facility_id uuid REFERENCES facilities(id) ON DELETE SET NULL,
    actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    request_id text,
    event_type text NOT NULL,
    resource_type text NOT NULL,
    resource_id uuid,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_events_facility_time_idx
    ON audit_events (facility_id, occurred_at DESC);

CREATE INDEX audit_events_request_id_idx
    ON audit_events (request_id)
    WHERE request_id IS NOT NULL;
