DELETE FROM deployment_profile_permissions
WHERE permission_code = 'system.ops.view';

DELETE FROM user_permissions
WHERE permission_code = 'system.ops.view';

DELETE FROM permission_assignments
WHERE permission_code = 'system.ops.view';

DELETE FROM delegations
WHERE permission_code = 'system.ops.view';

UPDATE position_templates
SET permission_codes = array_remove(permission_codes, 'system.ops.view'),
    updated_at = now()
WHERE 'system.ops.view' = ANY(permission_codes);
