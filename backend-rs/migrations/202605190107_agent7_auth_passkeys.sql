CREATE TABLE auth_webauthn_credentials (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    credential_id text NOT NULL UNIQUE,
    passkey jsonb NOT NULL,
    label text,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz,
    disabled_at timestamptz
);

CREATE INDEX auth_webauthn_credentials_user_active_idx
    ON auth_webauthn_credentials (facility_id, user_id, created_at DESC)
    WHERE disabled_at IS NULL;

CREATE TABLE auth_webauthn_challenges (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    ceremony_type text NOT NULL CHECK (ceremony_type IN ('registration', 'authentication')),
    state jsonb NOT NULL,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auth_webauthn_challenges_active_idx
    ON auth_webauthn_challenges (facility_id, user_id, ceremony_type, expires_at)
    WHERE consumed_at IS NULL;

CREATE TABLE auth_recovery_codes (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    code_hash text NOT NULL UNIQUE,
    generated_set_id uuid NOT NULL,
    used_at timestamptz,
    invalidated_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auth_recovery_codes_user_active_idx
    ON auth_recovery_codes (facility_id, user_id, created_at DESC)
    WHERE used_at IS NULL AND invalidated_at IS NULL;
