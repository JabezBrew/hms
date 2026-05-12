CREATE TABLE dashboard_snapshots (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    snapshot_key text NOT NULL,
    deployment_profile text NOT NULL REFERENCES deployment_profiles(code),
    metrics jsonb NOT NULL DEFAULT '[]'::jsonb,
    generated_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (facility_id, snapshot_key)
);

CREATE INDEX dashboard_snapshots_facility_generated_idx
    ON dashboard_snapshots (facility_id, generated_at DESC);

CREATE TABLE notifications (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    recipient_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notification_type text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    priority text NOT NULL,
    read_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notifications_recipient_created_idx
    ON notifications (recipient_user_id, created_at DESC, id DESC);

CREATE INDEX notifications_recipient_unread_idx
    ON notifications (recipient_user_id, created_at DESC, id DESC)
    WHERE read_at IS NULL;

CREATE TABLE realtime_subscription_audit (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel_name text NOT NULL,
    channel_kind text NOT NULL,
    opened_at timestamptz NOT NULL DEFAULT now(),
    closed_at timestamptz
);

CREATE INDEX realtime_subscription_audit_facility_opened_idx
    ON realtime_subscription_audit (facility_id, opened_at DESC);
