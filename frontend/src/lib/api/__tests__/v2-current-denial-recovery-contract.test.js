import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { __resetV2ApiClientForTests, configureV2ApiClient, getV2ClientScopeKey, v2Request } from '@/lib/api/v2/client';
import { bindNetworkAccessGuard, currentConfirmedNetworkDecision } from '@/lib/api/v2/networkAccessGuard';
import { activateWriteUncertainty, acknowledgeWriteResponse, acknowledgeWriteReview, getWriteUncertaintySnapshot } from '@/lib/api/v2/writeUncertainty';
import { inputDigest } from '@/features/admin/organization/model';

const [actor, facility, unitId, requestId] = Array.from({ length: 4 }, (_, n) => `83838383-8383-4383-8383-${String(n + 1).padStart(12, '0')}`);
const principal = { id: actor, facility_id: facility, active_profile: 'hospital' };
const authority = 'synthetic-current-denial-authority';
const payload = { client_request_id: requestId, expected_version: 1, name: 'Synthetic revised unit' };
const unit = { id: unitId, code: 'SYNTHETIC', name: payload.name, unit_type: 'service', parent_unit_id: null, parent_unit_name: null, is_active: true, version: 2, created_at: '2026-10-17T09:00:00Z', updated_at: '2026-10-17T09:05:00Z' };
const originalFetch = globalThis.fetch, originalRuntime = window.__HMS_RUNTIME_CONFIG__;
const allowed = { access_allowed: true, read_only: false, classification: 'onsite', policy_version: 1 };
const envelope = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const write = () => v2Request({ method: 'POST', path: '/api/v2/admin/org-units/{id}/rename', pathParams: { id: unitId }, body: payload });
let binding, transport, retained, receipt;
async function readReceipt() {
  fetch.mockResolvedValueOnce(envelope({ data: receipt }));
  await expect(v2Request({ path: '/api/v2/admin/org-units/commands/{client_request_id}', pathParams: { client_request_id: requestId } })).resolves.toMatchObject({ data: receipt });
  expect(getWriteUncertaintySnapshot().entries[0]?.reviewed).toBe(true);
}
const acknowledge = kind => kind === 'global' ? acknowledgeWriteReview(getWriteUncertaintySnapshot().entries[0].id, principal) : Promise.resolve().then(() => acknowledgeWriteResponse(retained));
async function applyDenial(mode) {
  if (mode === 'network-binding') {
    binding.update({ confirmed: true, decision: { ...allowed, access_allowed: false } });
    expect(currentConfirmedNetworkDecision(transport, authority)).toBeNull();
  } else {
    const calls = fetch.mock.calls.length;
    fetch.mockResolvedValueOnce(envelope({ error: { code: 'permission_denied', message: 'Synthetic current permission denied.' } }, 403));
    await expect(write()).rejects.toMatchObject({ status: 403 });
    expect(fetch).toHaveBeenCalledTimes(calls + 1);
  }
  expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
}
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' };
  __resetV2ApiClientForTests();
  configureV2ApiClient({ getAccessToken: () => 'SYNTHETIC-CURRENT-DENIAL-TOKEN', getFacilityCode: () => 'QA', canRefreshSession: () => false });
  transport = getV2ClientScopeKey();
  binding = bindNetworkAccessGuard({ transportScope: transport, authorityScope: authority, principal });
  binding.update({ confirmed: true, decision: allowed });
  activateWriteUncertainty(principal, { authority, transport });
  globalThis.fetch = vi.fn();
  fetch.mockRejectedValueOnce(new TypeError('Synthetic lost original reply'));
  retained = await write().catch(error => error);
  expect(retained).toMatchObject({ status: 0 });
  const reviewed = { action: 'rename', unit_id: unitId, ...payload };
  receipt = { client_request_id: requestId, input_digest: await inputDigest(reviewed), reviewed_input: reviewed, recorded_by_user_id: actor, unit, changed: true, recorded_at: '2026-10-17T09:04:00Z' };
  await readReceipt();
});
afterEach(() => {
  vi.restoreAllMocks(); __resetV2ApiClientForTests(); vi.unstubAllGlobals();
  globalThis.fetch = originalFetch; window.__HMS_RUNTIME_CONFIG__ = originalRuntime;
});
for (const mode of ['network-binding', 'settled-retry-403']) {
  it.each(['global', 'retained'])('current ' + mode + ' preserves the unknown marker before %s acknowledgment', async kind => {
    await applyDenial(mode);
    let rejected = false;
    try { await acknowledge(kind); } catch (error) { rejected = error.status === 409; }
    const remaining = getWriteUncertaintySnapshot().entries.length;
    expect(rejected).toBe(true);
    expect(remaining).toBe(1);
    binding.update({ confirmed: true, decision: allowed });
    await expect(acknowledge(kind)).rejects.toMatchObject({ status: 409 });
    expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
    await readReceipt();
    await acknowledge(kind);
    expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
  });
  it.each(['global', 'retained'])('fresh successful receipt after ' + mode + ' restores %s acknowledgment', async kind => {
    await applyDenial(mode);
    binding.update({ confirmed: true, decision: allowed });
    await readReceipt();
    await acknowledge(kind);
    expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
  });
}

it.each(['global', 'retained'])('a receipt returned while network denied cannot regain %s proof after restoration alone', async kind => {
  await applyDenial('network-binding');
  fetch.mockResolvedValueOnce(envelope({ data: receipt }));
  await expect(v2Request({ path: '/api/v2/admin/org-units/commands/{client_request_id}', pathParams: { client_request_id: requestId } })).resolves.toMatchObject({ data: receipt });
  expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(false);
  binding.update({ confirmed: true, decision: allowed });
  await expect(acknowledge(kind)).rejects.toMatchObject({ status: 409 });
  expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
  await readReceipt();
  await acknowledge(kind);
  expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
it.each(['global', 'retained'])('a pending receipt does not survive network denial and restoration for %s acknowledgment', async kind => {
  let dispatch, deliver;
  const started = new Promise(resolve => { dispatch = resolve; });
  fetch.mockImplementationOnce(() => { dispatch(); return new Promise(resolve => { deliver = () => resolve(envelope({ data: receipt })); }); });
  const pending = v2Request({ path: '/api/v2/admin/org-units/commands/{client_request_id}', pathParams: { client_request_id: requestId } });
  await started;
  await applyDenial('network-binding');
  binding.update({ confirmed: true, decision: allowed });
  deliver();
  await expect(pending).resolves.toMatchObject({ data: receipt });
  expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(false);
  await expect(acknowledge(kind)).rejects.toMatchObject({ status: 409 });
  expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
  await readReceipt();
  await acknowledge(kind);
  expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});

it.each(['global', 'retained'])('a current allowed read-only network still permits %s receipt acknowledgment', async kind => {
  binding.update({ confirmed: true, decision: { ...allowed, read_only: true } });
  expect(currentConfirmedNetworkDecision(transport, authority)).toMatchObject({ access_allowed: true, read_only: true });
  await readReceipt();
  await acknowledge(kind);
  expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});

async function malformedForbiddenRead() {
  const privateMarker = 'SYNTHETIC-DENIAL-CONTENT';
  fetch.mockResolvedValueOnce(new Response(privateMarker, { status: 403, headers: { 'content-type': 'application/json' } }));
  const failure = await v2Request({ path: '/api/v2/admin/org-units/{id}', pathParams: { id: unitId } }).catch(error => error);
  expect(failure).toMatchObject({ status: 403, data: { error: { code: 'request_denied' } } });
  expect(String(failure.message)).not.toContain(privateMarker.slice(0, 9));
  expect(JSON.stringify(failure.data)).not.toContain(privateMarker.slice(0, 9));
  expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
}
it.each(['global', 'retained'])('malformed current403 invalidates older %s receipt acknowledgment', async kind => {
  await malformedForbiddenRead();
  let rejected = false;
  try { await acknowledge(kind); } catch (error) { rejected = error.status === 409; }
  const remaining = getWriteUncertaintySnapshot().entries.length;
  expect(rejected).toBe(true);
  expect(remaining).toBe(1);
  await readReceipt();
  await acknowledge(kind);
  expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
it.each(['global', 'retained'])('fresh successful receipt after malformed403 restores %s acknowledgment', async kind => {
  await malformedForbiddenRead();
  await readReceipt();
  await acknowledge(kind);
  expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});

it.each(['global', 'retained'])('malformed exact retry403 preserves the old unknown marker for %s recovery', async kind => {
  fetch.mockResolvedValueOnce(new Response('SYNTHETIC-DENIAL-CONTENT', { status: 403, headers: { 'content-type': 'application/json' } }));
  await expect(write()).rejects.toMatchObject({ status: 403, data: { error: { code: 'request_denied' } } });
  expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
  await expect(acknowledge(kind)).rejects.toMatchObject({ status: 409 });
  await readReceipt();
  await acknowledge(kind);
  expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
it('malformed definite403 on a fresh tracked command does not invent unknown write state', async () => {
  await acknowledge('global');
  expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
  fetch.mockResolvedValueOnce(new Response('SYNTHETIC-DENIAL-CONTENT', { status: 403, headers: { 'content-type': 'application/json' } }));
  await expect(write()).rejects.toMatchObject({ status: 403, data: { error: { code: 'request_denied' } } });
  expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
