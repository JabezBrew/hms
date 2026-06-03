CREATE TABLE auth_login_failure_counters (
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
    resource_type text NOT NULL,
    resource_key text NOT NULL,
    window_started_at timestamptz NOT NULL,
    failure_count bigint NOT NULL CHECK (failure_count > 0),
    burst_audited_at timestamptz,
    last_failed_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (facility_id, resource_type, resource_key)
);
