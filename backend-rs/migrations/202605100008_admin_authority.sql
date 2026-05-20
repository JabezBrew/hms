CREATE TABLE organization_units (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    parent_unit_id uuid REFERENCES organization_units(id) ON DELETE RESTRICT,
    code text NOT NULL,
    name text NOT NULL,
    unit_type text NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (facility_id, code)
);

CREATE INDEX organization_units_facility_created_idx
    ON organization_units (facility_id, created_at, id);

CREATE INDEX organization_units_facility_parent_idx
    ON organization_units (facility_id, parent_unit_id);

CREATE TABLE position_templates (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    code text NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    permission_codes text[] NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (facility_id, code)
);

CREATE INDEX position_templates_facility_created_idx
    ON position_templates (facility_id, created_at, id);

CREATE TABLE positions (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    org_unit_id uuid NOT NULL REFERENCES organization_units(id) ON DELETE RESTRICT,
    template_id uuid REFERENCES position_templates(id) ON DELETE SET NULL,
    code text NOT NULL,
    title text NOT NULL,
    status text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (facility_id, code)
);

CREATE INDEX positions_facility_created_idx
    ON positions (facility_id, created_at, id);

CREATE INDEX positions_facility_unit_idx
    ON positions (facility_id, org_unit_id);

CREATE TABLE authority_appointments (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    position_id uuid NOT NULL REFERENCES positions(id) ON DELETE RESTRICT,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    appointed_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    appointment_type text NOT NULL,
    starts_at timestamptz NOT NULL DEFAULT now(),
    ends_at timestamptz,
    status text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX authority_appointments_one_active_idx
    ON authority_appointments (facility_id, position_id, user_id)
    WHERE status = 'active';

CREATE INDEX authority_appointments_facility_created_idx
    ON authority_appointments (facility_id, created_at, id);

CREATE TABLE permission_assignments (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    grantee_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    permission_code text NOT NULL,
    scope_type text NOT NULL,
    scope_id uuid,
    granted_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    starts_at timestamptz NOT NULL DEFAULT now(),
    ends_at timestamptz,
    status text NOT NULL,
    reason_code text NOT NULL DEFAULT 'authority_assignment',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX permission_assignments_one_active_idx
    ON permission_assignments (facility_id, grantee_user_id, permission_code, scope_type, (COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::uuid)))
    WHERE status = 'active';

CREATE INDEX permission_assignments_facility_created_idx
    ON permission_assignments (facility_id, created_at, id);

CREATE TABLE committees (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    code text NOT NULL,
    name text NOT NULL,
    mandate text NOT NULL,
    status text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (facility_id, code)
);

CREATE INDEX committees_facility_created_idx
    ON committees (facility_id, created_at, id);

CREATE TABLE delegations (
    id uuid PRIMARY KEY,
    facility_id uuid NOT NULL REFERENCES facilities(id) ON DELETE RESTRICT,
    delegator_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    delegate_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    permission_code text NOT NULL,
    starts_at timestamptz NOT NULL DEFAULT now(),
    ends_at timestamptz,
    status text NOT NULL,
    reason text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX delegations_one_active_idx
    ON delegations (facility_id, delegator_user_id, delegate_user_id, permission_code)
    WHERE status = 'active';

CREATE INDEX delegations_facility_created_idx
    ON delegations (facility_id, created_at, id);
