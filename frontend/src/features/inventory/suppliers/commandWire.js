import { reviewedInput } from './model';
// Authored supplier handler contract; compiled export verification is a release gate.
// Dispatch uses generated SDK operations, never this route reconstruction.
export function commandWire(input) {
  reviewedInput(input);
  const { action, supplier_id, ...body } = input;
  if (action === 'create') return { operation: 'postInventorySupplier', method: 'POST', path: '/api/v2/inventory/supplier-administration', body };
  const operation = { correct: 'postInventorySupplierCorrection', retire: 'postInventorySupplierRetire', reactivate: 'postInventorySupplierReactivate' }[action];
  const suffix = { correct: 'corrections', retire: 'retire', reactivate: 'reactivate' }[action];
  return { operation, method: 'POST', path: `/api/v2/inventory/suppliers/${supplier_id}/${suffix}`, pathParams: { id: supplier_id }, body };
}
