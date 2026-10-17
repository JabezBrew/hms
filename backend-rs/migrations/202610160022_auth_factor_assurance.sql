-- Existing sessions retain their password proof and start WITHOUT factor proof.
ALTER TABLE users ADD COLUMN auth_factor_version bigint NOT NULL DEFAULT 0 CHECK(auth_factor_version>=0);
ALTER TABLE refresh_sessions ADD COLUMN password_verified_at timestamptz;
UPDATE refresh_sessions SET password_verified_at=session_started_at;
ALTER TABLE refresh_sessions ALTER COLUMN password_verified_at SET NOT NULL;
ALTER TABLE refresh_sessions ALTER COLUMN password_verified_at SET DEFAULT clock_timestamp();

CREATE TABLE auth_session_assurance (
    session_id uuid PRIMARY KEY REFERENCES refresh_sessions(session_id) ON DELETE CASCADE,
    facility_id uuid NOT NULL REFERENCES facilities(id),
    user_id uuid NOT NULL REFERENCES users(id),
    session_version bigint NOT NULL,
    permission_version bigint NOT NULL,
    factor_version bigint NOT NULL,
    active_profile text NOT NULL,
    method text NOT NULL CHECK(method IN ('passkey','recovery')),
    credential_id uuid REFERENCES auth_webauthn_credentials(id),
    verified_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    CHECK(expires_at>verified_at AND expires_at<=verified_at+interval '15 minutes'),
    CHECK((method='passkey' AND credential_id IS NOT NULL) OR (method='recovery' AND credential_id IS NULL))
);
CREATE INDEX auth_session_assurance_expiry_idx ON auth_session_assurance(expires_at,session_id);
-- The bounded credential decoder visits at most the cap plus one in id order.
CREATE INDEX auth_webauthn_credentials_active_id_idx
 ON auth_webauthn_credentials(facility_id,user_id,id) WHERE disabled_at IS NULL;
CREATE INDEX auth_webauthn_credentials_history_idx
 ON auth_webauthn_credentials(facility_id,user_id,created_at DESC,id DESC);

CREATE TABLE auth_login_grants (
    id uuid PRIMARY KEY,
    token_hash text NOT NULL UNIQUE,
    facility_id uuid NOT NULL REFERENCES facilities(id),
    user_id uuid NOT NULL REFERENCES users(id),
    session_version bigint NOT NULL,
    permission_version bigint NOT NULL,
    factor_version bigint NOT NULL,
    active_profile text NOT NULL,
    password_verified_at timestamptz NOT NULL,
    device_label text,
    state text NOT NULL CHECK(state IN ('factor','setup')),
    failed_attempts smallint NOT NULL DEFAULT 0 CHECK(failed_attempts BETWEEN 0 AND 10),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    CHECK(expires_at>created_at)
);
CREATE INDEX auth_login_grants_active_idx ON auth_login_grants(facility_id,user_id,expires_at) WHERE consumed_at IS NULL;
CREATE INDEX auth_login_grants_cleanup_idx ON auth_login_grants(expires_at,id);

-- Operator-issued token is shown only once, stored hashed and grants no role.
CREATE TABLE auth_factor_bootstrap_grants (
    id uuid PRIMARY KEY,
    token_hash text NOT NULL UNIQUE,
    facility_id uuid NOT NULL REFERENCES facilities(id),
    user_id uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    CHECK(expires_at>created_at AND expires_at<=created_at+interval '30 minutes')
);
CREATE INDEX auth_factor_bootstrap_cleanup_idx ON auth_factor_bootstrap_grants(expires_at,id);

CREATE TABLE auth_factor_challenges (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id),
    user_id uuid NOT NULL REFERENCES users(id),
    purpose text NOT NULL CHECK(purpose IN ('login','setup','step_up')),
    login_grant_id uuid REFERENCES auth_login_grants(id) ON DELETE CASCADE,
    session_id uuid REFERENCES refresh_sessions(session_id) ON DELETE CASCADE,
    bootstrap_id uuid REFERENCES auth_factor_bootstrap_grants(id) ON DELETE CASCADE,
    session_version bigint NOT NULL,
    permission_version bigint NOT NULL,
    factor_version bigint NOT NULL,
    active_profile text NOT NULL,
    password_confirmation_at timestamptz,
    state jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    CHECK(expires_at>created_at),
    CHECK((purpose='step_up' AND session_id IS NOT NULL AND login_grant_id IS NULL AND bootstrap_id IS NULL)
       OR (purpose='login' AND session_id IS NULL AND login_grant_id IS NOT NULL AND bootstrap_id IS NULL)
       OR (purpose='setup' AND session_id IS NULL AND login_grant_id IS NOT NULL AND bootstrap_id IS NOT NULL))
);
CREATE INDEX auth_factor_challenges_active_idx ON auth_factor_challenges(facility_id,user_id,purpose,expires_at) WHERE consumed_at IS NULL;
CREATE INDEX auth_factor_challenges_cleanup_idx ON auth_factor_challenges(expires_at,id);
CREATE INDEX auth_factor_challenges_grant_idx ON auth_factor_challenges(login_grant_id) WHERE login_grant_id IS NOT NULL;
CREATE INDEX auth_factor_challenges_bootstrap_idx ON auth_factor_challenges(bootstrap_id) WHERE bootstrap_id IS NOT NULL;
CREATE INDEX auth_webauthn_challenges_cleanup_idx ON auth_webauthn_challenges(expires_at,id);

-- Account-wide epoch prevents warm caches/other sessions retaining withdrawn
-- factor evidence. No session/token is revoked merely by applying this schema.
CREATE FUNCTION auth_factor_credential_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' OR TG_OP='DELETE' OR NEW.disabled_at IS DISTINCT FROM OLD.disabled_at THEN
   UPDATE users SET auth_factor_version=auth_factor_version+1 WHERE id=COALESCE(NEW.user_id,OLD.user_id);
 END IF;
 RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER auth_factor_credential_changed AFTER INSERT OR DELETE OR UPDATE OF disabled_at ON auth_webauthn_credentials
 FOR EACH ROW EXECUTE FUNCTION auth_factor_credential_changed();

CREATE TABLE auth_factor_issue_budgets (
    facility_id uuid NOT NULL REFERENCES facilities(id),
    user_id uuid NOT NULL REFERENCES users(id),
    purpose text NOT NULL,
    window_started_at timestamptz NOT NULL,
    issued bigint NOT NULL CHECK(issued BETWEEN 1 AND 10),
    PRIMARY KEY(facility_id,user_id,purpose)
);
CREATE INDEX auth_factor_issue_cleanup_idx ON auth_factor_issue_budgets(window_started_at,user_id);

CREATE TABLE auth_factor_operator_actions (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id),
    user_id uuid NOT NULL REFERENCES users(id),
    credential_id uuid NOT NULL REFERENCES auth_webauthn_credentials(id),
    action text NOT NULL CHECK(action='credential_retired'),
    reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION preserve_auth_factor_operator_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'authentication operator evidence is immutable'; END $$;
CREATE TRIGGER preserve_auth_factor_operator_evidence BEFORE UPDATE OR DELETE ON auth_factor_operator_actions
 FOR EACH ROW EXECUTE FUNCTION preserve_auth_factor_operator_evidence();

ALTER TABLE refresh_sessions ADD COLUMN assurance_version bigint NOT NULL DEFAULT 0;
CREATE FUNCTION auth_session_assurance_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE refresh_sessions SET assurance_version=assurance_version+1 WHERE session_id=COALESCE(NEW.session_id,OLD.session_id);
 RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER auth_session_assurance_changed AFTER INSERT OR UPDATE OR DELETE ON auth_session_assurance
 FOR EACH ROW EXECUTE FUNCTION auth_session_assurance_changed();
ALTER TABLE refresh_sessions ADD CONSTRAINT refresh_sessions_identity_unique UNIQUE(session_id,facility_id,user_id);
ALTER TABLE auth_webauthn_credentials ADD CONSTRAINT auth_webauthn_identity_unique UNIQUE(id,facility_id,user_id);
ALTER TABLE auth_session_assurance ADD CONSTRAINT auth_assurance_session_identity_fk FOREIGN KEY(session_id,facility_id,user_id) REFERENCES refresh_sessions(session_id,facility_id,user_id) ON DELETE CASCADE;
ALTER TABLE auth_session_assurance ADD CONSTRAINT auth_assurance_key_identity_fk FOREIGN KEY(credential_id,facility_id,user_id) REFERENCES auth_webauthn_credentials(id,facility_id,user_id);
