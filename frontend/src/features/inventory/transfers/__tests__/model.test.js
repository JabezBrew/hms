import { expect, it } from 'vitest';
import { prepareTransferReview, selectedItem, transferPayload, transferResult, wholeQuantity } from '../model';
const item = { id: '24242424-0000-4000-8000-000000000041', code: 'SYNTHETIC-TRANSFER', name: 'Synthetic transfer item', unit: ' raw legacy box ' };
const from = '24242424-0000-4000-8000-000000000042', to = '24242424-0000-4000-8000-000000000043';
const draft = () => ({ item_id: item.id, from_location_id: from, to_location_id: to, quantity: '5' });
it.each(['', ' u '.repeat(121), 'mL', ' legacy raw box '])('preserves exact raw reviewed unit without catalog trim/120-char rules: %j', unit => {
  const source = { ...item, unit }, review = prepareTransferReview(draft(), source, source); expect(review.payload.expected_unit).toBe(unit); expect(review.payload.quantity).toBe(5); expect(Object.isFrozen(review.payload)).toBe(true);
});
it.each(['2.9', '2units', '2e3', '-2', ' 2 ', '', 0, -1, 2.9, Infinity, Number.MAX_SAFE_INTEGER + 1])('refuses non-whole/unrepresentable quantity %j without conversion', quantity => { expect(() => wholeQuantity(quantity)).toThrow(); });
it('accepts an exact safe whole i64-representable quantity without inventing a lower backend cap', () => { expect(wholeQuantity(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER); expect(wholeQuantity('5')).toBe(5); });
it.each(['id', 'code', 'name', 'unit'])('does not silently substitute a changed current item %s', field => {
  const current = { ...item, [field]: field === 'id' ? from : 'Changed' }; expect(() => prepareTransferReview(draft(), item, current)).toThrow();
});
it('copies selection and input instead of retaining caller aliases or truncating a legacy item array', () => {
  const selected = { ...item }, input = draft(), review = prepareTransferReview(input, selected, selected); selected.unit = 'Mutated'; input.quantity = 99;
  expect(review.payload.quantity).toBe(5); expect(review.item.unit).toBe(item.unit);
  expect(() => prepareTransferReview({ ...draft(), items: [{ item_id: item.id }] }, item, item)).toThrow();
  expect(() => transferPayload({ ...review.payload, client_request_id: from })).toThrow();
});
it('requires distinct exact locations and refuses an explicitly inactive selected source', () => {
  expect(() => prepareTransferReview({ ...draft(), to_location_id: from }, item, item)).toThrow();
  expect(() => selectedItem({ ...item, is_active: false })).toThrow();
});
it('confirms only the exact returned request/unit/quantity, without treating it as a governed command receipt', () => {
  const review = prepareTransferReview(draft(), item, item), result = { id: to, requested_unit: item.unit, item_id: item.id, item_name: 'Current server item label', from_location_id: from, to_location_id: to, quantity: 5, status: 'requested', created_at: '2026-10-31T00:01:00Z' };
  expect(transferResult(result, review.payload)).toMatchObject({ requested_unit: item.unit, quantity: 5 });
  for (const changed of [{ requested_unit: null }, { requested_unit: 'different' }, { quantity: 6 }, { item_id: from }, { status: 'completed' }, { client_request_id: from }]) expect(() => transferResult({ ...result, ...changed }, review.payload)).toThrow();
});
