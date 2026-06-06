CREATE UNIQUE INDEX wards_facility_id_pair_idx
    ON wards (facility_id, id);

CREATE UNIQUE INDEX practitioner_profiles_facility_id_pair_idx
    ON practitioner_profiles (facility_id, id);

CREATE UNIQUE INDEX users_facility_id_pair_idx
    ON users (facility_id, id);

CREATE TABLE ward_staff_assignments (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    ward_id uuid NOT NULL,
    practitioner_profile_id uuid NOT NULL,
    role_code text NOT NULL,
    role_name text NOT NULL,
    role_category text NOT NULL CHECK (role_category IN ('nursing', 'medical', 'allied', 'operational')),
    is_active boolean NOT NULL DEFAULT TRUE,
    is_primary boolean NOT NULL DEFAULT FALSE,
    assigned_by_user_id uuid,
    updated_by_user_id uuid,
    assigned_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ward_staff_assignments_primary_active_chk
        CHECK (is_active = TRUE OR is_primary = FALSE),
    CONSTRAINT ward_staff_assignments_ward_facility_fk
        FOREIGN KEY (facility_id, ward_id)
        REFERENCES wards (facility_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT ward_staff_assignments_practitioner_facility_fk
        FOREIGN KEY (facility_id, practitioner_profile_id)
        REFERENCES practitioner_profiles (facility_id, id)
        ON DELETE CASCADE,
    CONSTRAINT ward_staff_assignments_assigned_by_facility_fk
        FOREIGN KEY (facility_id, assigned_by_user_id)
        REFERENCES users (facility_id, id)
        ON DELETE RESTRICT,
    CONSTRAINT ward_staff_assignments_updated_by_facility_fk
        FOREIGN KEY (facility_id, updated_by_user_id)
        REFERENCES users (facility_id, id)
        ON DELETE RESTRICT
);

CREATE UNIQUE INDEX ward_staff_assignments_one_active_pair_idx
    ON ward_staff_assignments (facility_id, ward_id, practitioner_profile_id)
    WHERE is_active = TRUE;

CREATE UNIQUE INDEX ward_staff_assignments_one_primary_ward_idx
    ON ward_staff_assignments (facility_id, practitioner_profile_id)
    WHERE is_active = TRUE AND is_primary = TRUE;

CREATE INDEX ward_staff_assignments_ward_active_idx
    ON ward_staff_assignments (facility_id, ward_id, is_active, assigned_at, id);

CREATE INDEX ward_staff_assignments_practitioner_active_idx
    ON ward_staff_assignments (facility_id, practitioner_profile_id, is_active, is_primary, assigned_at, id);

CREATE INDEX ward_staff_assignments_role_active_idx
    ON ward_staff_assignments (facility_id, role_category, is_active, assigned_at, id);
