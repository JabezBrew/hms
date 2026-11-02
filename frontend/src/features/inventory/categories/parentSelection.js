import { assertWriteRecoveryReadCurrent } from '@/lib/api/v2/writeUncertainty';
import { categoryDetail, same } from './model';
export function confirmParent(selection) {
  if (!selection?.response || !selection.lease?.isCurrent() || !selection.isCurrent?.() || !selection.response.data?.some(row => same(row, selection.row)) || !selection.row.is_active) throw new Error('Choose an exact active parent from a current authorized category page.');
  assertWriteRecoveryReadCurrent(selection.response); return selection.row;
}
export function confirmParentDetail(selection, result) {
  const selected = confirmParent(selection), detail = categoryDetail(result.value, selected.id);
  assertWriteRecoveryReadCurrent(result.response);
  if (!detail.category.is_active || detail.category.version !== selected.version || detail.category.code !== selected.code || detail.category.name !== selected.name) throw new Error('The selected parent changed after selection. Refresh and select its current revision.');
  return { parent_id: selected.id, expected_parent_version: selected.version };
}
