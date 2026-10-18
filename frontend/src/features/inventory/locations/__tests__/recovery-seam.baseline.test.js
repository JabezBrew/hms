import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { __resetV2ApiClientForTests, configureV2ApiClient, getV2ClientScopeKey, v2Request } from '@/lib/api/v2/client';
import { bindNetworkAccessGuard } from '@/lib/api/v2/networkAccessGuard';
import { activateWriteUncertainty, getWriteUncertaintySnapshot, WRITE_UNCERTAINTY_KEY } from '@/lib/api/v2/writeUncertainty';
const ids = Array.from({ length: 5 }, (_, n) => `21212121-2121-4121-8121-${String(n + 1).padStart(12, '0')}`);
const [actor, facility, locationId, requestId] = ids;
const principal = { id: actor, facility_id: facility, active_profile: 'hospital' };
const root = '/api/v2/inventory/storage-locations', payload = { client_request_id: requestId, expected_version: 1, name: 'Synthetic revised unit' };
const location = { id: locationId, code: 'SYNTHETIC', name: payload.name, location_type: 'store', temperature_zone: 'ambient', is_active: true, version: 2, created_at: '2026-10-17T09:00:00Z', updated_at: '2026-10-17T09:05:00Z' };
const runtime = window.__HMS_RUNTIME_CONFIG__, originalFetch = globalThis.fetch;
const json = data => new Response(JSON.stringify({ data }), { headers: { 'content-type': 'application/json' } });
function bind(token = 'SYNTHETIC-ORGANIZATION-TOKEN', authority = 'synthetic-storage location-authority', who = principal) {
  configureV2ApiClient({ getAccessToken: () => token, getFacilityCode: () => 'QA', canRefreshSession: () => false });
  const transport = getV2ClientScopeKey();
  bindNetworkAccessGuard({ transportScope: transport, authorityScope: authority, principal: who }).update({ confirmed: true, decision: { access_allowed: true, read_only: false, classification: 'onsite', policy_version: 1 } });
  activateWriteUncertainty(who, { authority, transport });
}
const write = (body = payload, suffix = 'rename') => v2Request({ method: 'POST', path: root + '/{id}/' + suffix, pathParams: { id: locationId }, body });
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' }; __resetV2ApiClientForTests(); bind(); globalThis.fetch = vi.fn();
  fetch.mockRejectedValueOnce(new TypeError('Synthetic lost reply')); await expect(write()).rejects.toMatchObject({ status: 0 });
});
afterEach(() => { __resetV2ApiClientForTests(); vi.unstubAllGlobals(); globalThis.fetch = originalFetch; window.__HMS_RUNTIME_CONFIG__ = runtime; });
it('a current storage location read cannot prove an unknown command finished', async () => {
  fetch.mockResolvedValueOnce(json(location)); await v2Request({ path: root + '/{id}/administration', pathParams: { id: locationId } });
  expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(false);
});
it('a different workflow read preserves the storage location command barrier', async () => {
  fetch.mockResolvedValueOnce(json({ id: locationId })); await v2Request({ path: '/api/v2/admin/positions' });
  expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(false);
});
