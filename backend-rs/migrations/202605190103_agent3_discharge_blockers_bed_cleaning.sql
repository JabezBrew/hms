ALTER TABLE discharge_cases
    ADD COLUMN IF NOT EXISTS nursing_release_education text,
    ADD COLUMN IF NOT EXISTS nursing_release_instructions text,
    ADD COLUMN IF NOT EXISTS nursing_released_at timestamptz,
    ADD COLUMN IF NOT EXISTS nursing_released_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS pharmacy_required boolean NOT NULL DEFAULT false;

ALTER TABLE wards
    ADD COLUMN IF NOT EXISTS bed_cleaning_minutes_override integer
        CHECK (bed_cleaning_minutes_override IS NULL OR bed_cleaning_minutes_override BETWEEN 0 AND 1440);

ALTER TABLE beds
    ADD COLUMN IF NOT EXISTS cleaning_due_at timestamptz;

CREATE TABLE IF NOT EXISTS discharge_blocker_holds (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    discharge_case_id uuid NOT NULL REFERENCES discharge_cases(id) ON DELETE CASCADE,
    blocker_type text NOT NULL,
    reason text NOT NULL,
    held_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    held_at timestamptz NOT NULL DEFAULT now(),
    released_at timestamptz,
    UNIQUE (discharge_case_id, blocker_type)
);

CREATE INDEX IF NOT EXISTS discharge_blocker_holds_active_idx
    ON discharge_blocker_holds (facility_id, discharge_case_id, blocker_type)
    WHERE released_at IS NULL;

CREATE TABLE IF NOT EXISTS discharge_blocker_overrides (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    discharge_case_id uuid NOT NULL REFERENCES discharge_cases(id) ON DELETE CASCADE,
    blocker_type text NOT NULL,
    reason text NOT NULL,
    overridden_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    reauth_verified_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (discharge_case_id, blocker_type)
);

CREATE INDEX IF NOT EXISTS discharge_blocker_overrides_case_idx
    ON discharge_blocker_overrides (facility_id, discharge_case_id, blocker_type);

CREATE INDEX IF NOT EXISTS beds_cleaning_due_idx
    ON beds (facility_id, cleaning_due_at, id)
    WHERE status = 'cleaning' AND cleaning_due_at IS NOT NULL;
