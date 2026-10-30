import { inputDigest, prepareCommand } from '../model';
export const ids = Array.from({ length: 12 }, (_, n) => `23232323-2323-4232-8232-${String(n + 1).padStart(12, '0')}`);
export const [actorId, facilityId, serviceId, requestId, otherId] = ids;
export const at = '2026-10-18T00:00:00Z';
export const service = { id: serviceId, code: 'SYNTHETIC', name: 'Synthetic bookable service', default_duration_minutes: 30, is_active: true, version: 1, created_at: at, updated_at: at };
export const actor = { id: actorId, role: 'pharmacist', facilityCode: 'QA', adminAccess: { capabilities: ['appointment.view', 'appointment.manage', 'patient.demographics.view'] }, accessContext: { facility_id: facilityId, active_profile: 'hospital', permission_version: 1, features: ['appointments'], patient_visibility: ['demographics'], auth_security: { privileged_actions_allowed: false, passkey_required: false, passkey_enrolled: false } } };
export const envelope = (rows, next = null) => ({ data: rows, page: { limit: 25, has_next: next !== null, next_cursor: next } });
export async function makeCommand(action = 'metadata', previous = service) {
  const input = action === 'create' ? { action, client_request_id: requestId, code: 'SYNTHETIC_NEW', name: 'Synthetic new service', default_duration_minutes: 45 } : { action, client_request_id: requestId, service_id: previous.id, expected_version: previous.version, ...(action === 'metadata' ? { name: 'Synthetic corrected service', default_duration_minutes: 45 } : {}) };
  return prepareCommand(input, actorId, action === 'create' ? null : previous);
}
export async function makeReceipt(command, changed = true) {
  const { input, previous } = command;
  const saved = input.action === 'create' ? { ...service, id: ids[8], code: input.code, name: input.name, default_duration_minutes: input.default_duration_minutes } : { ...previous, name: input.name ?? previous.name, default_duration_minutes: input.default_duration_minutes ?? previous.default_duration_minutes, is_active: input.action === 'retire' ? false : input.action === 'reactivate' ? true : previous.is_active, version: previous.version + (changed ? 1 : 0) };
  return { client_request_id: input.client_request_id, input_digest: await inputDigest(input), reviewed_input: input, recorded_by_user_id: command.actorId, service: saved, changed, recorded_at: at };
}
