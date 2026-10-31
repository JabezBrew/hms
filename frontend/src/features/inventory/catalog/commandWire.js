import { reviewedInput } from './model';
// Only reconstruct the four actual exported request shapes for opaque recovery
// fingerprint matching. Sending always uses the root-generated SDK operations.
export function commandWire(input) {
  reviewedInput(input);
  const { action, ...fields } = input;
  if (action === 'create') return { operation: 'postInventoryItemCreate', method: 'POST', path: '/api/v2/inventory/items', body: fields };
  if (action === 'correct') return { operation: 'postInventoryCatalogEdit', method: 'POST', path: '/api/v2/inventory/catalog-edits', body: fields };
  const { item_id, ...body } = fields;
  return action === 'retire'
    ? { operation: 'postInventoryItemRetire', method: 'POST', path: `/api/v2/inventory/items/${item_id}/retire`, pathParams: { id: item_id }, body }
    : { operation: 'postInventoryItemReactivate', method: 'POST', path: `/api/v2/inventory/items/${item_id}/reactivate`, pathParams: { id: item_id }, body };
}
