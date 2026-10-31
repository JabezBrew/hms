import { exact, validId, validTimestamp } from '../catalog/model';
const invalid = () => new Error('Review one exact active item, distinct locations and a whole positive quantity before requesting a transfer.');
const requireValue = condition => { if (!condition) throw invalid(); };
const immutable = value => { if (value && typeof value === 'object') { Object.values(value).forEach(immutable); Object.freeze(value); } return value; };
export class TransferSourceChangedError extends Error { constructor() { super('The selected item changed. Select it again and enter the quantity for its reviewed unit. No transfer was requested.'); this.name = 'TransferSourceChangedError'; } }
export function wholeQuantity(value) {
  const number = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
  // The backend stores i64. JavaScript must still represent the exact reviewed
  // whole value; never parse a fractional/exponent/junk prefix into another one.
  requireValue(Number.isSafeInteger(number) && number > 0); return number;
}
export function selectedItem(value, id = null) {
  requireValue(validId(value?.id) && (id === null || value.id === id) && ['code', 'name', 'unit'].every(key => typeof value[key] === 'string')
    && (!Object.hasOwn(value, 'is_active') || value.is_active === true));
  // The API must read through the actual active-item purpose. This immutable
  // projection does not manufacture active-item authority or an inferred unit.
  return immutable({ id: value.id, code: value.code, name: value.name, unit: value.unit });
}
export function transferPayload(value) {
  requireValue(exact(value, ['item_id', 'from_location_id', 'to_location_id', 'quantity', 'expected_unit']) && validId(value.item_id)
    && validId(value.from_location_id) && validId(value.to_location_id) && value.from_location_id !== value.to_location_id
    && Number.isSafeInteger(value.quantity) && value.quantity > 0 && typeof value.expected_unit === 'string');
  return value;
}
export function prepareTransferReview(draft, selection, current) {
  const input = structuredClone(draft), chosen = selectedItem(structuredClone(selection)), fresh = selectedItem(structuredClone(current), chosen.id);
  requireValue(exact(input, ['item_id', 'from_location_id', 'to_location_id', 'quantity']) && input.item_id === chosen.id);
  if (['id', 'code', 'name', 'unit'].some(key => chosen[key] !== fresh[key])) throw new TransferSourceChangedError();
  // Keep the unit the operator actually selected; a later adapter refresh must
  // never substitute another basis or convert the entered quantity.
  const payload = transferPayload({ ...input, quantity: wholeQuantity(input.quantity), expected_unit: chosen.unit });
  return immutable({ payload, item: chosen });
}
export function transferResult(value, reviewed) {
  const payload = transferPayload(reviewed);
  requireValue(exact(value, ['requested_unit', 'id', 'item_id', 'item_name', 'from_location_id', 'to_location_id', 'quantity', 'status', 'created_at'])
    && validId(value.id) && typeof value.item_name === 'string' && value.item_id === payload.item_id
    && value.from_location_id === payload.from_location_id && value.to_location_id === payload.to_location_id
    && value.quantity === payload.quantity && value.requested_unit === payload.expected_unit && value.status === 'requested' && validTimestamp(value.created_at));
  return immutable(structuredClone(value));
}
