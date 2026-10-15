-- Existing copies cannot be distinguished from independently assigned permissions.
-- Preserve them until a fresh administrator explicitly reconciles their origin.
ALTER TABLE user_permissions ADD COLUMN origin text NOT NULL DEFAULT 'direct'
    CHECK (origin IN ('direct', 'legacy_unresolved'));
UPDATE user_permissions up SET origin = 'legacy_unresolved'
WHERE EXISTS (SELECT 1 FROM permission_assignments pa WHERE pa.grantee_user_id = up.user_id AND pa.permission_code = up.permission_code)
   OR EXISTS (SELECT 1 FROM delegations d WHERE d.delegate_user_id = up.user_id AND d.permission_code = up.permission_code);

ALTER TABLE permission_assignments ADD COLUMN revoked_at timestamptz,
    ADD COLUMN revoked_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE delegations ADD COLUMN revoked_at timestamptz,
    ADD COLUMN revoked_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE authority_appointments ADD COLUMN revoked_at timestamptz,
    ADD COLUMN revoked_by_user_id uuid REFERENCES users(id) ON DELETE RESTRICT;

CREATE INDEX permission_assignments_user_effective_idx
    ON permission_assignments (grantee_user_id, facility_id, starts_at, ends_at) WHERE status = 'active';
CREATE INDEX delegations_user_effective_idx
    ON delegations (delegate_user_id, facility_id, starts_at, ends_at) WHERE status = 'active';
CREATE INDEX authority_appointments_user_effective_idx
    ON authority_appointments (user_id, facility_id, starts_at, ends_at) WHERE status = 'active';

-- Organization-unit grants retain their scoped authority semantics; they must
-- never become facility-wide direct permissions through materialization.
CREATE VIEW effective_user_permissions AS
SELECT user_id, permission_code FROM user_permissions
UNION
SELECT pa.grantee_user_id, pa.permission_code
FROM permission_assignments pa JOIN users u ON u.id = pa.grantee_user_id AND u.facility_id = pa.facility_id
WHERE pa.status = 'active' AND pa.starts_at <= now() AND (pa.ends_at IS NULL OR pa.ends_at > now())
  AND pa.scope_type = 'facility' AND pa.scope_id IS NULL
UNION
SELECT d.delegate_user_id, d.permission_code
FROM delegations d JOIN users u ON u.id = d.delegate_user_id AND u.facility_id = d.facility_id
WHERE d.status = 'active' AND d.starts_at <= now() AND (d.ends_at IS NULL OR d.ends_at > now());

CREATE VIEW user_authority_boundaries AS
SELECT facility_id, grantee_user_id AS user_id, starts_at, ends_at FROM permission_assignments WHERE status = 'active'
UNION ALL
SELECT facility_id, delegate_user_id, starts_at, ends_at FROM delegations WHERE status = 'active'
UNION ALL
SELECT facility_id, user_id, starts_at, ends_at FROM authority_appointments WHERE status = 'active';

-- Force existing sessions to rehydrate the changed permission projection.
UPDATE users SET permission_version = permission_version + 1, updated_at = now()
WHERE EXISTS (SELECT 1 FROM permission_assignments pa WHERE pa.grantee_user_id = users.id)
   OR EXISTS (SELECT 1 FROM delegations d WHERE d.delegate_user_id = users.id);
