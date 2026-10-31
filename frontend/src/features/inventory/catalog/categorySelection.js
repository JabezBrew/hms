import { assertWriteRecoveryReadCurrent } from '@/lib/api/v2/writeUncertainty';
import { same } from './model';
export function confirmCategory(selection) {
  if (!selection?.response || !selection.response.data?.some(row => same(row, selection.row))) throw new Error('Choose an exact category from a current authorized page.');
  assertWriteRecoveryReadCurrent(selection.response); return selection.row;
}
