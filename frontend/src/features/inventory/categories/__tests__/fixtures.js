import { prepareCommand } from '../model';
export const categoryId = '25252525-0000-4000-8000-000000000001';
export const parentId = '25252525-0000-4000-8000-000000000002';
export const actorId = '25252525-0000-4000-8000-000000000003';
export const requestId = '25252525-0000-4000-8000-000000000004';
export const historyId = '25252525-0000-4000-8000-000000000005';
export const stamp = '2026-10-31T10:20:30.123456Z';
export const category = { id: categoryId, code: 'SYNTHETIC-25', name: 'Synthetic supplies', description: null, parent_id: null, parent: null, is_active: true, version: 1, catalog_changed_at: null, created_at: '2036-10-30T00:00:00Z', created_by_user_id: null, updated_by_user_id: null };
export const parent = { ...category, id: parentId, code: 'PARENT-25', name: 'Synthetic parent' };
export const listItem = value => Object.fromEntries(['id', 'code', 'name', 'is_active', 'version', 'parent_id', 'catalog_changed_at', 'created_at'].map(key => [key, value[key]]));
export const creation = { action: 'create', client_request_id: requestId, code: 'SYNTHETIC-NEW', name: 'Synthetic new category', description: null, parent: null };
export const correction = { action: 'correct', client_request_id: requestId, category_id: categoryId, expected_version: 1, name: 'Synthetic corrected category', description: '', parent_change: { action: 'retain' }, reason: 'Synthetic metadata review' };
// The actual Rust response::list function emits standard meta:{}.
export const page = data => ({ data, page: { limit: 25, has_next: false, next_cursor: null }, meta: {} });
export const detail = value => ({ category: value, eligibility: { lifecycle_blocked_by: null, parent_unavailable: value.parent_id !== null && value.parent === null } });
export async function makeResult(input = correction, previous = category) {
  const command = await prepareCommand(input, actorId, input.action === 'create' ? null : previous);
  const fixed = command.input;
  let next;
  if (fixed.action === 'create') next = { ...structuredClone(category), code: fixed.code, name: fixed.name, description: fixed.description, created_at: stamp, catalog_changed_at: stamp, created_by_user_id: actorId, updated_by_user_id: actorId };
  else next = { ...structuredClone(previous), ...(fixed.action === 'correct' ? { name: fixed.name, description: fixed.description } : { is_active: fixed.action === 'reactivate' }) };
  const choice = fixed.action === 'create' ? fixed.parent : fixed.parent_change;
  if (choice?.parent_id) { next.parent_id = choice.parent_id; next.parent = { id: choice.parent_id, code: parent.code, name: parent.name, version: choice.expected_parent_version, is_active: true }; }
  else if (choice?.action === 'clear' || fixed.action === 'create') { next.parent_id = null; next.parent = null; }
  const changed = fixed.action === 'create' || (fixed.action === 'correct' ? ['name', 'description', 'parent_id'].some(key => next[key] !== previous[key]) : previous.is_active !== next.is_active);
  if (fixed.action !== 'create') next = { ...next, version: previous.version + Number(changed), catalog_changed_at: changed ? stamp : previous.catalog_changed_at, updated_by_user_id: changed ? actorId : previous.updated_by_user_id };
  return { command, receipt: { client_request_id: fixed.client_request_id, input_digest: command.digest, reviewed_input: structuredClone(fixed), recorded_by_user_id: actorId, category: next, changed, recorded_at: stamp, before: fixed.action === 'create' ? null : structuredClone(previous) } };
}
