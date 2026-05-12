ALTER TABLE refresh_sessions
    ADD COLUMN session_family_id uuid,
    ADD COLUMN rotated_from_session_id uuid REFERENCES refresh_sessions(session_id),
    ADD COLUMN last_seen_at timestamptz,
    ADD COLUMN revoked_reason text;

UPDATE refresh_sessions
SET session_family_id = session_id
WHERE session_family_id IS NULL;

ALTER TABLE refresh_sessions
    ALTER COLUMN session_family_id SET NOT NULL;

CREATE INDEX refresh_sessions_family_active_idx
    ON refresh_sessions (session_family_id, expires_at)
    WHERE revoked_at IS NULL;

CREATE TABLE password_reset_tokens (
    token_hash text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX password_reset_tokens_user_active_idx
    ON password_reset_tokens (user_id, expires_at)
    WHERE used_at IS NULL;

CREATE TABLE password_history (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    password_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX password_history_user_time_idx
    ON password_history (user_id, created_at DESC);

CREATE TABLE domain_events (
    id uuid PRIMARY KEY,
    event_type text NOT NULL,
    aggregate_type text NOT NULL,
    aggregate_id uuid,
    facility_id uuid REFERENCES facilities(id) ON DELETE SET NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX domain_events_facility_time_idx
    ON domain_events (facility_id, occurred_at DESC);

CREATE TABLE jobs (
    id uuid PRIMARY KEY,
    kind text NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    status text NOT NULL DEFAULT 'queued',
    attempts integer NOT NULL DEFAULT 0,
    available_at timestamptz NOT NULL DEFAULT now(),
    locked_by text,
    locked_at timestamptz,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX jobs_queue_idx
    ON jobs (status, available_at, created_at);
