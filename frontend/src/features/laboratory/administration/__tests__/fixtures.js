import { inputDigest, prepareCommand } from '../model';
export const ids = Array.from({ length: 12 }, (_, index) => `27272727-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);
export const [actorId, facilityId, testId, panelId, requestId, commandId, otherId] = ids;
export const stamp = '2026-11-04T10:00:00.123456Z';
export const changedStamp = '2026-11-04T11:00:00.123456Z';
export const manager = () => ({ id: actorId, role: 'ordinary_catalog_manager', facilityCode: 'QA27', adminAccess: { capabilities: ['laboratory.catalog.manage'] }, accessContext: { facility_id: facilityId, active_profile: 'hospital', session_version: 1, permission_version: 1, features: ['laboratory'], patient_visibility: [] } });
export function subject(kind = 'test', overrides = {}, ordering = null) {
  const definition = { id: kind === 'test' ? testId : panelId, code: kind === 'test' ? 'S27-TEST' : 'S27-PANEL', name: `Synthetic ${kind} definition`, is_active: true, is_system_default: false, is_facility_modified: false, created_at: stamp, updated_at: stamp, version: 1, catalog_changed_at: null, catalog_changed_by_user_id: null, ...(kind === 'test' ? { category: null, specimen_type: 'Synthetic specimen', result_unit: null } : { test_count: 2 }), ...overrides };
  return { kind, definition, ordering: ordering || (definition.is_active ? { is_orderable: true, blocked_by: null } : { is_orderable: false, blocked_by: 'inactive' }) };
}
export const listItem = source => Object.fromEntries(['id', 'code', 'name', 'is_active', 'version', 'catalog_changed_at', 'created_at'].map(key => [key, source.definition[key]]));
export const page = (rows, cursor = null) => ({ data: rows, page: { limit: 25, has_next: cursor !== null, next_cursor: cursor }, meta: {} });
export const input = (source = subject(), active = false, uuid = requestId) => ({ action: 'set_availability', subject_kind: source.kind, subject_id: source.definition.id, client_request_id: uuid, expected_version: source.definition.version, is_active: active, reason: 'Synthetic exact availability reason' });
export async function result(commandInput = input(), previous = subject(), ordering = null) {
  const command = await prepareCommand(commandInput, actorId, previous), reviewed = command.input, changed = previous.definition.is_active !== reviewed.is_active;
  const recorded = subject(previous.kind, { ...previous.definition, is_active: reviewed.is_active, version: reviewed.expected_version + Number(changed), ...(changed ? { updated_at: changedStamp, catalog_changed_at: changedStamp, catalog_changed_by_user_id: actorId } : {}) }, ordering || (reviewed.is_active ? { is_orderable: true, blocked_by: null } : { is_orderable: false, blocked_by: 'inactive' }));
  return { command, receipt: { command_id: commandId, client_request_id: reviewed.client_request_id, input_digest: await inputDigest(reviewed), reviewed_input: structuredClone(reviewed), subject: recorded, recorded_at: changedStamp, recorded_by_user_id: actorId, changed } };
}
