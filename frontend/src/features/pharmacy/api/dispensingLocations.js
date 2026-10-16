import { getV2ClientScopeKey, v2Api } from '@/lib/api/v2/client';
import { hashQueryValue } from '@/shared/lib/privateQueryKey';
export function dispensingScope(user) {
  return JSON.stringify([getV2ClientScopeKey(), user?.id, user?.facilityCode, user?.accessContext?.facility_id, user?.accessContext?.active_profile,
    hashQueryValue(JSON.stringify([...(user?.adminAccess?.capabilities || [])].sort()))]);
}
export const dispensingLocationKeys = { search: (nonce, cursor) => ['pharmacy-dispensing-locations', getV2ClientScopeKey(), nonce, cursor || 'first'] };
export async function getDispensingLocations({ search, cursor, signal } = {}) {
  const response = await v2Api.getPharmacyDispensingLocations({ query: { limit: 25, ...(search?.trim() ? { search: search.trim() } : {}), ...(cursor ? { cursor } : {}) }, signal });
  if (!Array.isArray(response?.data) || response.data.some((item) => !item.id || typeof item.code !== 'string' || !item.name)
    || typeof response.page?.has_next !== 'boolean' || (response.page.has_next && (!response.page.next_cursor || response.page.next_cursor === cursor))) throw new Error('Dispensing locations could not be confirmed.');
  return response;
}
