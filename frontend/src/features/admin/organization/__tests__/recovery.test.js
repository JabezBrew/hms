import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { __resetV2ApiClientForTests, configureV2ApiClient, getV2ClientScopeKey, v2Request } from '@/lib/api/v2/client';
import { bindNetworkAccessGuard } from '@/lib/api/v2/networkAccessGuard';
import { activateWriteUncertainty, acknowledgeWriteReview, acknowledgeWriteResponse, markWriteResponseUncertain, getWriteUncertaintySnapshot, resetWriteUncertaintyForTests, organizationCommandRecoveryCandidate, WRITE_UNCERTAINTY_KEY } from '@/lib/api/v2/writeUncertainty';
import { inputDigest, canonical } from '../model';
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
afterEach(() => { __resetV2ApiClientForTests(); vi.unstubAllGlobals(); globalThis.fetch = originalFetch; window.__HMS_RUNTIME_CONFIG__ = runtime; });
it('a current organization unit read cannot prove an unknown command finished', async () => {
  fetch.mockResolvedValueOnce(json(unit)); await v2Request({ path: root + '/{id}', pathParams: { id: unitId } });
  expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(false);
});
it('a different workflow read preserves the organization command barrier', async () => {
  fetch.mockResolvedValueOnce(json({ id: unitId })); await v2Request({ path: '/api/v2/admin/positions' });
  expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(false);
});
const input = { action: 'rename', unit_id: unitId, ...payload };
async function receiptValue() { return { client_request_id: requestId, input_digest: await inputDigest(input), reviewed_input: input, recorded_by_user_id: actor, unit, changed: true, recorded_at: '2026-10-17T09:04:00Z' }; }
const readReceipt = () => v2Request({ path: root + '/commands/{client_request_id}', pathParams: { client_request_id: requestId } });
async function assertBlocked() {
  const entry = getWriteUncertaintySnapshot().entries[0]; expect(entry.reviewed).toBe(false);
  await expect(acknowledgeWriteReview(entry.id, principal)).rejects.toBeDefined(); expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
}
it('only the typed actual actor original receipt permits a separate explicit acknowledgment', async () => {
  fetch.mockResolvedValueOnce(json(await receiptValue())); await readReceipt();
  const entry = getWriteUncertaintySnapshot().entries[0]; expect(entry.reviewed).toBe(true);
  await acknowledgeWriteReview(entry.id, principal); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
it.each(['actor', 'digest', 'request', 'version', 'extra-input'])('rejects %s corruption in an alleged original receipt', async kind => {
  const receipt = await receiptValue();
  if (kind === 'actor') receipt.recorded_by_user_id = ids[4];
  if (kind === 'digest') receipt.input_digest = '0'.repeat(64);
  if (kind === 'request') receipt.client_request_id = ids[4];
  if (kind === 'version') receipt.unit = { ...unit, version: 7 };
  if (kind === 'extra-input') receipt.reviewed_input = { ...input, unsupported: true };
  fetch.mockResolvedValueOnce(json(receipt)); await readReceipt(); await assertBlocked();
});
it.each(['/commands/not-a-uuid', '/commands/' + requestId + '/extra', '/history', '/{id}/children', '/{id}/ancestors', '/{id}/descendants', '//commands/' + requestId])('rejects unknown or ordinary recovery evidence at %s', async suffix => {
  fetch.mockResolvedValueOnce(json(await receiptValue())); await v2Request({ path: root + suffix, pathParams: { id: unitId } }); await assertBlocked();
});
it.each(['denial', 'ABA', 'active-retry', 'changed-uncertainty'])('pending original receipt digest respects %s', async transition => {
  const receipt = await receiptValue(); const original = crypto.subtle.digest.bind(crypto.subtle); let release, entered, intercept = true;
  const paused = new Promise(resolve => { release = resolve; }), began = new Promise(resolve => { entered = resolve; });
  const expected = JSON.stringify(canonical(input));
  const spy = vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (algorithm, bytes) => { if (intercept && new TextDecoder().decode(bytes) === expected) { intercept = false; entered(); await paused; } return original(algorithm, bytes); });
  let finishRetry, retry;
  try {
    fetch.mockResolvedValueOnce(json(receipt)); const pending = readReceipt(); await began;
    if (transition === 'denial') {
      fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'forbidden' } }), { status: 403, headers: { 'content-type': 'application/json' } }));
      await expect(v2Request({ path: root + '/{id}', pathParams: { id: unitId } })).rejects.toMatchObject({ status: 403 });
    } else if (transition === 'ABA') { bind('SYNTHETIC-B', 'synthetic-authority-B'); await vi.waitFor(() => expect(getWriteUncertaintySnapshot().entries).toHaveLength(1)); bind(); await vi.waitFor(() => expect(getWriteUncertaintySnapshot().entries).toHaveLength(1)); }
    else if (transition === 'active-retry') {
      fetch.mockReturnValueOnce(new Promise((resolve, reject) => { finishRetry = () => reject(new TypeError('Synthetic retry lost')); })); retry = write().catch(error => error);
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    } else { fetch.mockRejectedValueOnce(new TypeError('Synthetic retry lost')); await expect(write()).rejects.toMatchObject({ status: 0 }); }
    release(); await pending; await assertBlocked();
  } finally { release(); if (finishRetry) finishRetry(); if (retry) await retry; spy.mockRestore(); }
});
it.each(['create', 'rename', 'retire', 'reactivate'])('allows only unchanged explicit %s retry with the retained UUID', async action => {
  resetWriteUncertaintyForTests(); bind();
  const body = action === 'create' ? { client_request_id: requestId, code: 'SYNTHETIC', name: 'Synthetic unit', unit_type: 'service', parent_unit_id: null } : action === 'rename' ? payload : { client_request_id: requestId, expected_version: 1 };
  const send = value => action === 'create' ? v2Request({ method: 'POST', path: root, body: value }) : write(value, action);
  fetch.mockRejectedValueOnce(new TypeError('Synthetic command lost')); await expect(send(body)).rejects.toMatchObject({ status: 0 }); const original = fetch.mock.calls.at(-1);
  await expect(send({ ...body, client_request_id: ids[4] })).rejects.toBeDefined();
  fetch.mockResolvedValueOnce(json({})); await send(body); const latest = fetch.mock.calls.at(-1);
  expect(latest[0]).toBe(original[0]); expect(latest[1].body).toBe(original[1].body);
});
it('does not allow unchanged retry of a malformed extra command suffix', async () => {
  resetWriteUncertaintyForTests(); bind(); fetch.mockRejectedValueOnce(new TypeError('Synthetic command lost')); await expect(write(payload, 'rename/extra')).rejects.toMatchObject({ status: 0 });
  const calls = fetch.mock.calls.length; await expect(write(payload, 'rename/extra')).rejects.toBeDefined(); expect(fetch).toHaveBeenCalledTimes(calls);
});
it('recovers only the original actor receipt after a full reload, with separate acknowledgment and no body retry', async () => {
  resetWriteUncertaintyForTests({ preserveStorage: true }); bind(); await vi.waitFor(() => expect(getWriteUncertaintySnapshot().entries).toHaveLength(1));
  expect(await organizationCommandRecoveryCandidate()).toBe(requestId); expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(false);
  fetch.mockResolvedValueOnce(json(await receiptValue())); await readReceipt(); expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(true);
  await acknowledgeWriteReview(getWriteUncertaintySnapshot().entries[0].id, principal); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
it('does not return another actor or facility scope command candidate', async () => {
  bind('SYNTHETIC-OTHER', 'synthetic-other-authority', { ...principal, id: ids[4] }); await vi.waitFor(() => expect(getWriteUncertaintySnapshot().entries).toHaveLength(0)); expect(await organizationCommandRecoveryCandidate()).toBeNull();
});
it('does not return a different workflow family candidate', async () => {
  resetWriteUncertaintyForTests(); bind(); fetch.mockRejectedValueOnce(new TypeError('Synthetic other-family response loss')); await expect(v2Request({ method: 'POST', path: '/api/v2/admin/positions', body: payload })).rejects.toMatchObject({ status: 0 }); expect(await organizationCommandRecoveryCandidate()).toBeNull();
});
it('does not expose a candidate while an exact retry is active', async () => {
  let finish; fetch.mockReturnValueOnce(new Promise((resolve, reject) => { finish = () => reject(new TypeError('Synthetic active retry loss')); })); const pending = write().catch(error => error);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2)); expect(await organizationCommandRecoveryCandidate()).toBeNull(); finish(); await pending;
});
it('does not guess between two concurrent original organization UUIDs', async () => {
  resetWriteUncertaintyForTests(); bind(); const fail = [];
  fetch.mockImplementation(() => new Promise((resolve, reject) => { fail.push(() => reject(new TypeError('Synthetic concurrent reply loss'))); }));
  const first = write().catch(error => error), second = write({ ...payload, client_request_id: ids[4] }).catch(error => error);
  await vi.waitFor(() => expect(fail).toHaveLength(2)); fail.forEach(done => done()); await Promise.all([first, second]); expect(await organizationCommandRecoveryCandidate()).toBeNull();
});
it('rejects a candidate digest that finishes after activation A→B→A', async () => {
  const original = crypto.subtle.digest.bind(crypto.subtle); let release, enter, intercept = true;
  const paused = new Promise(resolve => { release = resolve; }), began = new Promise(resolve => { enter = resolve; });
  const spy = vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (algorithm, bytes) => { if (intercept && new TextDecoder().decode(bytes).includes('family:api/v2/admin/org-units')) { intercept = false; enter(); await paused; } return original(algorithm, bytes); });
  try { const pending = organizationCommandRecoveryCandidate(); await began; bind('SYNTHETIC-B', 'synthetic-authority-B'); await vi.waitFor(() => expect(getWriteUncertaintySnapshot().entries).toHaveLength(1)); bind(); await vi.waitFor(() => expect(getWriteUncertaintySnapshot().entries).toHaveLength(1)); release(); expect(await pending).toBeNull(); } finally { release(); spy.mockRestore(); }
});
it('fails closed on invalid persisted recovery storage', async () => {
  resetWriteUncertaintyForTests(); sessionStorage.setItem(WRITE_UNCERTAINTY_KEY, '{"version":999}'); bind(); expect(await organizationCommandRecoveryCandidate()).toBeNull(); await vi.waitFor(() => expect(getWriteUncertaintySnapshot().unavailable).toBe(true));
});

const retainedAck = () => acknowledgeWriteResponse(retainedFailure);
const denyCurrentRead = async () => {fetch.mockResolvedValueOnce(new Response(JSON.stringify({error:{code:'forbidden'}}),{status:403,headers:{'content-type':'application/json'}}));await expect(v2Request({path:'/api/v2/admin/positions'})).rejects.toMatchObject({status:403});};
async function validOriginalRead(){fetch.mockResolvedValueOnce(json(await receiptValue()));await readReceipt();}
it('does not let a retained opaque write handle acknowledge without an actual fresh original receipt',async()=>{expect(retainedAck).toThrow();expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);});
it('allows a retained opaque handle only after the current original receipt was validated',async()=>{await validOriginalRead();expect(retainedAck).not.toThrow();expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);});
it.each(['denial','ABA','active-retry','changed-uncertainty','late-mark-uncertain'])('retained acknowledgment rejects later %s',async transition=>{
 await validOriginalRead();let finish,retry;
 if(transition==='denial')await denyCurrentRead();
 else if(transition==='ABA'){bind('SYNTHETIC-B','synthetic-authority-B');await vi.waitFor(()=>expect(getWriteUncertaintySnapshot().entries).toHaveLength(1));bind();await vi.waitFor(()=>expect(getWriteUncertaintySnapshot().entries).toHaveLength(1));}
 else if(transition==='active-retry'){fetch.mockReturnValueOnce(new Promise((resolve,reject)=>{finish=()=>reject(new TypeError('Synthetic active retry lost'));}));retry=write().catch(error=>error);await vi.waitFor(()=>expect(fetch).toHaveBeenCalledTimes(3));}
 else if(transition==='changed-uncertainty'){fetch.mockRejectedValueOnce(new TypeError('Synthetic nonce replacement'));await expect(write()).rejects.toMatchObject({status:0});}
 else markWriteResponseUncertain(retainedFailure);
 try{expect(retainedAck).toThrow();expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);}finally{finish?.();if(retry)await retry;}
});
it('recovers a retained command with a genuinely new original read after denial',async()=>{await validOriginalRead();await denyCurrentRead();expect(retainedAck).toThrow();await validOriginalRead();expect(retainedAck).not.toThrow();expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);});
it('fails closed when acknowledgment persistence faults, preserving the old persisted marker for reload',async()=>{await validOriginalRead();const spy=vi.spyOn(sessionStorage,'setItem').mockImplementation(()=>{throw new Error('Synthetic storage fault');});try{expect(retainedAck).toThrow();expect(getWriteUncertaintySnapshot().unavailable).toBe(true);}finally{spy.mockRestore();}resetWriteUncertaintyForTests({preserveStorage:true});bind();await vi.waitFor(()=>expect(getWriteUncertaintySnapshot().entries).toHaveLength(1));expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(false);});
it('keeps normal already-confirmed write response acknowledgment compatible',async()=>{await validOriginalRead();retainedAck();fetch.mockResolvedValueOnce(json({id:unitId}));const response=await write({...payload,client_request_id:ids[4]});expect(()=>acknowledgeWriteResponse(response)).not.toThrow();expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);});

it.each([false,true])('actual original-read canceled during canonical digest=%s must not publish recovery review',async canceled=>{
 const reviewed={action:'rename',unit_id:unitId,...payload},receipt={client_request_id:requestId,input_digest:await inputDigest(reviewed),reviewed_input:reviewed,recorded_by_user_id:actor,unit,changed:true,recorded_at:'2026-10-17T09:04:00Z'},controller=new AbortController();const original=crypto.subtle.digest.bind(crypto.subtle);let enter,release,intercept=true;const began=new Promise(resolve=>enter=resolve),paused=new Promise(resolve=>release=resolve),expected=JSON.stringify(canonical(reviewed));
 const spy=vi.spyOn(crypto.subtle,'digest').mockImplementation(async(algorithm,bytes)=>{if(intercept&&new TextDecoder().decode(bytes)===expected){intercept=false;enter();await paused;}return original(algorithm,bytes);});
 try{fetch.mockResolvedValueOnce(json(receipt));const pending=v2Request({path:root+'/commands/{client_request_id}',pathParams:{client_request_id:requestId},signal:controller.signal}).catch(error=>error);await began;if(canceled)controller.abort();release();const result=await pending;if(canceled)expect(result).toMatchObject({name:'AbortError'});else expect(result.data).toEqual(receipt);expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(!canceled);if(canceled)expect(()=>acknowledgeWriteResponse(retainedFailure)).toThrow();}
 finally{release();spy.mockRestore();}
});
