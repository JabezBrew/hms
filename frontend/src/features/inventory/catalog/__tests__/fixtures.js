export const itemId = '24242424-0000-4000-8000-000000000001';
export const categoryId = '24242424-0000-4000-8000-000000000002';
export const actorId = '24242424-0000-4000-8000-000000000003';
export const requestId = '24242424-0000-4000-8000-000000000004';
export const revisionId = '24242424-0000-4000-8000-000000000005';
export const stamp = '2026-10-30T14:20:00.123456Z';
export const today = '2026-10-30';
export const item = {
  id: itemId, category_id: categoryId, category: { id: categoryId, code: 'SYNTHETIC', name: 'Synthetic supplies' },
  code: 'SYNTHETIC-24', name: 'Synthetic catalog item', unit: 'pack', item_type: 'supply', controlled: false,
  effective_controlled: false, is_active: true, version: 1, catalog_changed_at: null, created_at: '2036-10-30T00:00:00Z',
};
export const correction = {
  action: 'correct', client_request_id: requestId, item_id: itemId, expected_version: 1,
  code: item.code, name: 'Synthetic corrected name', unit: item.unit, effective_from: '2020-02-29', reason: 'Synthetic dated label review',
};
export const creation = { action: 'create', client_request_id: requestId, category_id: categoryId, code: 'SYNTHETIC-NEW', name: 'Synthetic new item', unit: 'tablet', item_type: 'medication' };
export function page(data) { return { data, page: { limit: 25, has_next: false, next_cursor: null }, meta: {} }; }

import { prepareCommand } from '../model';
const copy = value => structuredClone(value);
export async function makeResult(input = correction, previous = item, options = { today }) {
  const command = await prepareCommand(input, actorId, input.action === 'create' ? null : previous, options);
  const changed = input.action === 'create' || (input.action === 'correct' ? ['code', 'name', 'unit'].some(key => command.input[key] !== previous[key]) : previous.is_active !== (input.action === 'reactivate'));
  const next = input.action === 'create' ? { ...copy(item), id: itemId, category_id: command.input.category_id, category: { ...item.category, id: command.input.category_id }, code: command.input.code, name: command.input.name, unit: command.input.unit, item_type: command.input.item_type, created_at: stamp, catalog_changed_at: stamp } : { ...copy(previous), ...(input.action === 'correct' ? { code: command.input.code, name: command.input.name, unit: command.input.unit } : { is_active: input.action === 'reactivate' }), version: previous.version + Number(changed), catalog_changed_at: changed ? stamp : previous.catalog_changed_at };
  const revision = input.action === 'correct' ? { id: revisionId, reviewed_effective_from: command.input.effective_from, recorded_at: stamp,
    before: { code: previous.code, name: previous.name, unit: previous.unit, version: previous.version },
    after: { code: next.code, name: next.name, unit: next.unit, version: next.version }, projection_changed: changed } : null;
  return { command, receipt: { client_request_id: command.input.client_request_id, input_digest: command.digest, reviewed_input: copy(command.input), recorded_by_user_id: actorId, item: next, changed, recorded_at: stamp, correction_revision: revision } };
}
