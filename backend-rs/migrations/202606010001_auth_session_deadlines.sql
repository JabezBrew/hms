ALTER TABLE refresh_sessions
    ADD COLUMN session_started_at timestamptz,
    ADD COLUMN idle_expires_at timestamptz,
    ADD COLUMN absolute_expires_at timestamptz;

UPDATE refresh_sessions
SET session_started_at = created_at
WHERE session_started_at IS NULL;

UPDATE refresh_sessions
SET absolute_expires_at = LEAST(expires_at, session_started_at + interval '8 hours')
WHERE absolute_expires_at IS NULL;

UPDATE refresh_sessions
SET idle_expires_at = LEAST(
        expires_at,
        absolute_expires_at,
        COALESCE(last_seen_at, created_at) + interval '30 minutes'
    )
WHERE idle_expires_at IS NULL;

UPDATE refresh_sessions
SET expires_at = LEAST(expires_at, idle_expires_at, absolute_expires_at);

ALTER TABLE refresh_sessions
    ALTER COLUMN session_started_at SET DEFAULT now(),
    ALTER COLUMN idle_expires_at SET DEFAULT (now() + interval '30 minutes'),
    ALTER COLUMN absolute_expires_at SET DEFAULT (now() + interval '8 hours'),
    ALTER COLUMN session_started_at SET NOT NULL,
    ALTER COLUMN idle_expires_at SET NOT NULL,
    ALTER COLUMN absolute_expires_at SET NOT NULL,
    ADD CONSTRAINT refresh_sessions_idle_before_absolute_chk
        CHECK (idle_expires_at <= absolute_expires_at),
    ADD CONSTRAINT refresh_sessions_started_before_absolute_chk
        CHECK (session_started_at <= absolute_expires_at);
