export const ids = Array.from({ length: 10 }, (_, n) => `21212121-2121-4121-8121-${String(n + 1).padStart(12, '0')}`);
export const [actorId, facilityId, locationId, requestId, otherId] = ids;
export const at = '2026-10-17T09:00:00Z';
export const location = { id: locationId, code: 'SYNTHETIC', name: 'Synthetic storage location', location_type: 'store', temperature_zone: 'ambient', is_active: true, version: 1, created_at: at, updated_at: at };
export const actor = { id: actorId, role: 'doctor', facilityCode: 'QA', adminAccess: { capabilities: ['inventory.view', 'inventory.manage', 'patient.demographics.view'] }, accessContext: { facility_id: facilityId, active_profile: 'hospital', permission_version: 1, features: ['inventory'], patient_visibility: ['demographics'], auth_security: { privileged_actions_allowed: false } } };
export const envelope = (rows, next = null) => ({ data: rows, page: { limit: 25, has_next: next !== null, next_cursor: next } });
