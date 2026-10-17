-- Challenges are ephemeral credential ceremonies, never authentication proof.
-- Retire only old challenges whose initiating session was never recorded.
ALTER TABLE auth_webauthn_challenges
    ADD COLUMN initiating_session_id uuid REFERENCES refresh_sessions(session_id) ON DELETE CASCADE,
    ADD COLUMN session_version bigint,
    ADD COLUMN permission_version bigint,
    ADD COLUMN active_profile text;

UPDATE auth_webauthn_challenges
SET consumed_at = COALESCE(consumed_at, clock_timestamp())
WHERE initiating_session_id IS NULL AND consumed_at IS NULL;

ALTER TABLE auth_webauthn_challenges
    ADD CONSTRAINT auth_webauthn_challenges_bound_proof CHECK (
        (initiating_session_id IS NULL AND session_version IS NULL
         AND permission_version IS NULL AND active_profile IS NULL
         AND consumed_at IS NOT NULL)
        OR
        (initiating_session_id IS NOT NULL AND session_version IS NOT NULL
         AND permission_version IS NOT NULL AND active_profile IS NOT NULL)
    );
