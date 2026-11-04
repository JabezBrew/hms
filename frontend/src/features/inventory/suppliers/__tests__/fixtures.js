import { CONTACT_FIELDS, prepareCommand } from '../model';
export const supplierId = '26262626-0000-4000-8000-000000000001';
export const otherId = '26262626-0000-4000-8000-000000000002';
export const actorId = '26262626-0000-4000-8000-000000000003';
export const requestId = '26262626-0000-4000-8000-000000000004';
export const historyId = '26262626-0000-4000-8000-000000000005';
export const stamp = '2026-11-02T10:20:30.123456Z';
export const supplier = { id: supplierId, code: 'SYNTHETIC-26', name: 'Synthetic supplier', contact_name: null, phone: null, email: null, address: null, is_active: true, version: 1, catalog_changed_at: null, created_at: '2026-10-30T00:00:00Z', updated_at: '2026-10-30T00:00:00Z', created_by_user_id: null, updated_by_user_id: null };
export const otherSupplier = { ...supplier, id: otherId, code: 'OTHER-26', name: 'Synthetic other supplier' };
export const listItem = value => Object.fromEntries(['id', 'code', 'name', 'is_active', 'version', 'catalog_changed_at', 'created_at'].map(key => [key, value[key]]));
export const creation = { action: 'create', client_request_id: requestId, code: 'SYNTHETIC-NEW', name: 'Synthetic new supplier', contact_name: null, phone: null, email: null, address: null };
export const correction = { action: 'correct', client_request_id: requestId, supplier_id: supplierId, expected_version: 1, name: 'Synthetic corrected supplier', contact_name: null, phone: null, email: null, address: null, reason: 'Synthetic metadata review' };
export const page = data => ({ data, page: { limit: 25, has_next: false, next_cursor: null }, meta: {} });
export const detail = value => ({ supplier: value, eligibility: { lifecycle_blocked_by: null } });
export async function makeResult(input = correction, previous = supplier) {
  const command = await prepareCommand(input, actorId, input.action === 'create' ? null : previous), fixed = command.input;
  const metadata = ['name', ...CONTACT_FIELDS], values = Object.fromEntries(metadata.map(field => [field, fixed[field]]));
  let next = fixed.action === 'create' ? { ...structuredClone(supplier), code: fixed.code, ...values, created_at: stamp, updated_at: stamp, catalog_changed_at: stamp, created_by_user_id: actorId, updated_by_user_id: actorId }
    : { ...structuredClone(previous), ...(fixed.action === 'correct' ? values : { is_active: fixed.action === 'reactivate' }) };
  const changed = fixed.action === 'create' || (fixed.action === 'correct' ? metadata.some(field => next[field] !== previous[field]) : previous.is_active !== next.is_active);
  if (fixed.action !== 'create') next = { ...next, version: previous.version + Number(changed), catalog_changed_at: changed ? stamp : previous.catalog_changed_at, updated_at: changed ? stamp : previous.updated_at, updated_by_user_id: changed ? actorId : previous.updated_by_user_id };
  return { command, receipt: { client_request_id: fixed.client_request_id, input_digest: command.digest, reviewed_input: structuredClone(fixed), recorded_by_user_id: actorId, supplier: next, changed, recorded_at: stamp, before: fixed.action === 'create' ? null : structuredClone(previous) } };
}
