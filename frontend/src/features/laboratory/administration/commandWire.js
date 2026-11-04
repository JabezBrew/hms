import { reviewedInput } from './model';
export const CATALOG_OPERATIONS = Object.freeze([
  'getLaboratoryTestAdministration', 'getLaboratoryTestAdministrationById', 'getLaboratoryTestHistory', 'postLaboratoryTestAvailability',
  'getLaboratoryPanelAdministration', 'getLaboratoryPanelAdministrationById', 'getLaboratoryPanelHistory', 'postLaboratoryPanelAvailability',
  'getLaboratoryCatalogCommandReceipt',
]);
export class CatalogContractUnavailable extends Error {
  constructor() { super('Laboratory administration is unavailable in this client release.'); this.name = 'CatalogContractUnavailable'; }
}
// No hand-written transport routes or substitute producer. The proposal stays
// unavailable with the old compiled client until the actual backend export.
export async function catalogOperations() {
  const { operations } = await import('@/lib/api/v2/generated/client');
  if (!CATALOG_OPERATIONS.every(name => operations[name]?.operationId === name)) throw new CatalogContractUnavailable();
  return operations;
}
export async function commandWire(input) {
  reviewedInput(input);
  const operation = input.subject_kind === 'test' ? 'postLaboratoryTestAvailability' : 'postLaboratoryPanelAvailability';
  const descriptor = (await catalogOperations())[operation];
  if (descriptor.method !== 'POST' || descriptor.hasBody !== true || descriptor.pathParamNames?.length !== 1 || descriptor.pathParamNames[0] !== 'id') throw new CatalogContractUnavailable();
  return { operation, pathParams: { id: input.subject_id }, method: descriptor.method,
    path: descriptor.path.replace('{id}', encodeURIComponent(input.subject_id)),
    body: { client_request_id: input.client_request_id, expected_version: input.expected_version, is_active: input.is_active, reason: input.reason } };
}
