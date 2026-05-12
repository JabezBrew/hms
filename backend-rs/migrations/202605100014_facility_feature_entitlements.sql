CREATE TABLE facility_feature_entitlements (
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
    feature_key text NOT NULL,
    enabled boolean NOT NULL,
    updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (facility_id, feature_key)
);

CREATE INDEX facility_feature_entitlements_updated_idx
    ON facility_feature_entitlements (facility_id, updated_at DESC, feature_key);
