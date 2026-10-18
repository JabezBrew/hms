export const ids = Array.from({ length: 10 }, (_, n) => `20202020-2020-4020-8020-${String(n + 1).padStart(12, '0')}`);
export const [actorId, facilityId, unitId, requestId, otherId] = ids;
export const at = '2026-10-17T09:00:00Z';
export const unit = { id: unitId, code: 'SYNTHETIC', name: 'Synthetic specialist service', unit_type: 'service', parent_unit_id: otherId, parent_unit_name: 'Synthetic parent outside page one', is_active: true, version: 1, created_at: at, updated_at: at };
export const actor = { id: actorId, role: 'doctor', facilityCode: 'QA', adminAccess: { capabilities: ['admin.authority.manage'] }, accessContext: { facility_id: facilityId, active_profile: 'hospital', permission_version: 1, features: ['admin'], auth_security: { privileged_actions_allowed: false } } };
export const envelope = (rows, next = null) => ({ data: rows, page: { limit: 25, has_next: next !== null, next_cursor: next } });
