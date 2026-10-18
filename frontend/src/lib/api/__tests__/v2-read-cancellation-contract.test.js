import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { __resetV2ApiClientForTests, configureV2ApiClient, getV2ClientScopeKey, v2Request } from '@/lib/api/v2/client';
import { bindNetworkAccessGuard } from '@/lib/api/v2/networkAccessGuard';
import { activateWriteUncertainty, acknowledgeWriteResponse, acknowledgeWriteReview, getWriteUncertaintySnapshot } from '@/lib/api/v2/writeUncertainty';
import { inputDigest, canonical } from '@/features/admin/organization/model';
const ids = Array.from({ length: 5 }, (_, n) => `20202020-2020-4020-8020-${String(n + 1).padStart(12, '0')}`);
const [actor, facility, unitId, requestId] = ids;
const principal = { id: actor, facility_id: facility, active_profile: 'hospital' };
const root = '/api/v2/admin/org-units', payload = { client_request_id: requestId, expected_version: 1, name: 'Synthetic revised unit' };
const unit = { id: unitId, code: 'SYNTHETIC', name: payload.name, unit_type: 'service', parent_unit_id: null, parent_unit_name: null, is_active: true, version: 2, created_at: '2026-10-17T09:00:00Z', updated_at: '2026-10-17T09:05:00Z' };
const runtime = window.__HMS_RUNTIME_CONFIG__, originalFetch = globalThis.fetch; let retainedFailure;
const json = data => new Response(JSON.stringify({ data }), { headers: { 'content-type': 'application/json' } });
function bind(token = 'SYNTHETIC-ORGANIZATION-TOKEN', authority = 'synthetic-organization-authority', who = principal) {
  configureV2ApiClient({ getAccessToken: () => token, getFacilityCode: () => 'QA', canRefreshSession: () => false });
  const transport = getV2ClientScopeKey();
  bindNetworkAccessGuard({ transportScope: transport, authorityScope: authority, principal: who }).update({ confirmed: true, decision: { access_allowed: true, read_only: false, classification: 'onsite', policy_version: 1 } });
  activateWriteUncertainty(who, { authority, transport });
}
const write = (body = payload, suffix = 'rename') => v2Request({ method: 'POST', path: root + '/{id}/' + suffix, pathParams: { id: unitId }, body });
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' }; __resetV2ApiClientForTests(); bind(); globalThis.fetch = vi.fn();
  fetch.mockRejectedValueOnce(new TypeError('Synthetic lost reply')); retainedFailure=await write().catch(error=>error); expect(retainedFailure).toMatchObject({status:0});
});
afterEach(() => { vi.restoreAllMocks(); __resetV2ApiClientForTests(); vi.unstubAllGlobals(); globalThis.fetch = originalFetch; window.__HMS_RUNTIME_CONFIG__ = runtime; });

it.each([false,true])('a receipt read canceled during canonical validation rejects AbortError and cannot review its original write, canceled=%s',async canceled=>{
 const reviewed={action:'rename',unit_id:unitId,...payload},receipt={client_request_id:requestId,input_digest:await inputDigest(reviewed),reviewed_input:reviewed,recorded_by_user_id:actor,unit,changed:true,recorded_at:'2026-10-17T09:04:00Z'},controller=new AbortController();const original=crypto.subtle.digest.bind(crypto.subtle);let enter,release,intercept=true;const began=new Promise(resolve=>enter=resolve),paused=new Promise(resolve=>release=resolve),expected=JSON.stringify(canonical(reviewed));
 const spy=vi.spyOn(crypto.subtle,'digest').mockImplementation(async(algorithm,bytes)=>{if(intercept&&new TextDecoder().decode(bytes)===expected){intercept=false;enter();await paused;}return original(algorithm,bytes);});
 try{fetch.mockResolvedValueOnce(json(receipt));const pending=v2Request({path:root+'/commands/{client_request_id}',pathParams:{client_request_id:requestId},signal:controller.signal});await began;if(canceled)controller.abort();release();const result=await pending.then(value=>({value}),error=>({error}));const reviewedNow=getWriteUncertaintySnapshot().entries[0].reviewed;expect(reviewedNow).toBe(!canceled);if(canceled){expect(()=>acknowledgeWriteResponse(retainedFailure)).toThrow();expect(result.error?.name).toBe('AbortError');}else expect(result.error).toBeUndefined();}
 finally{release();spy.mockRestore();}
});

it.each([false, true])('manual acknowledgment keeps completed receipt proof current until the gesture, canceled=%s', async (canceled) => {
  const reviewed = { action: 'rename', unit_id: unitId, ...payload };
  const receipt = { client_request_id: requestId, input_digest: await inputDigest(reviewed), reviewed_input: reviewed, recorded_by_user_id: actor, unit, changed: true, recorded_at: '2026-10-17T09:04:00Z' };
  const controller = new AbortController();
  fetch.mockResolvedValueOnce(json(receipt));
  await expect(v2Request({ path: root + '/commands/{client_request_id}', pathParams: { client_request_id: requestId }, signal: controller.signal })).resolves.toMatchObject({ data: receipt });
  const entry = getWriteUncertaintySnapshot().entries[0];
  expect(entry.reviewed).toBe(true);
  if (canceled) controller.abort();
  const acknowledgment = acknowledgeWriteReview(entry.id, principal);
  if (canceled) {
    await expect(acknowledgment).rejects.toMatchObject({ status: 409 });
    expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
  } else {
    await expect(acknowledgment).resolves.toBeUndefined();
    expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
  }
});
