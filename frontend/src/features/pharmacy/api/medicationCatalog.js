import { v2Api, getV2ClientScopeKey } from '@/lib/api/v2/client';
import { createKeyFactory } from '@/shared/lib/queryKeys';

const baseKeys = createKeyFactory('medication-catalog');
export const medicationCatalogKeys = {
  ...baseKeys,
  search: (requestScope) => [...baseKeys.all, getV2ClientScopeKey(), requestScope],
};

export async function getMedicationCatalog({ search, cursor, signal } = {}) {
  return v2Api.getClinicalMedicationCatalog({
    query: { search: search?.trim() || undefined, cursor, limit: 25 },
    signal,
  });
}
