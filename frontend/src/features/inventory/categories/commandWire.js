import { reviewedInput } from './model';
// Mirrors the actual compiled/exported operations solely for exact opaque
// fingerprint reconstruction. Dispatch uses the generated SDK methods.
export function commandWire(input) {
  reviewedInput(input);
  const { action, category_id, ...body } = input;
  if (action === 'create') return { operation: 'postInventoryCategory', method: 'POST', path: '/api/v2/inventory/category-administration', body };
  const operation = { correct: 'postInventoryCategoryCorrection', retire: 'postInventoryCategoryRetire', reactivate: 'postInventoryCategoryReactivate' }[action];
  const suffix = { correct: 'corrections', retire: 'retire', reactivate: 'reactivate' }[action];
  return { operation, method: 'POST', path: `/api/v2/inventory/categories/${category_id}/${suffix}`, pathParams: { id: category_id }, body };
}
