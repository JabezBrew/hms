-- Admission is separate from audit failure counters: a password verification
-- reserves capacity before CPU work and converts it to a failure or releases it.
-- No database transaction remains open while credentials are verified.
CREATE TABLE auth_login_attempt_budgets (
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
    resource_type text NOT NULL,
    resource_key text NOT NULL,
    window_started_at timestamptz NOT NULL,
    failed_attempts smallint NOT NULL DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 10),
    in_flight_attempts smallint NOT NULL DEFAULT 0 CHECK (in_flight_attempts BETWEEN 0 AND 10),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (facility_id, resource_type, resource_key),
    CHECK (failed_attempts + in_flight_attempts <= 10)
);

-- Preserve active failure budgets when introducing atomic admission.
INSERT INTO auth_login_attempt_budgets (
    facility_id, resource_type, resource_key, window_started_at, failed_attempts
)
SELECT facility_id, resource_type, resource_key, window_started_at,
       LEAST(failure_count, 10)::smallint
FROM auth_login_failure_counters
WHERE window_started_at > now() - interval '15 minutes';
