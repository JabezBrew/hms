import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { __resetV2ApiClientForTests, configureV2ApiClient, getV2ClientScopeKey, v2Request } from '@/lib/api/v2/client';
import { bindNetworkAccessGuard } from '@/lib/api/v2/networkAccessGuard';
import { activateWriteUncertainty, referralResponseManualReview, getWriteUncertaintySnapshot, resetWriteUncertaintyForTests, WRITE_UNCERTAINTY_KEY } from '@/lib/api/v2/writeUncertainty';
import { consultationManualReview } from '../recovery';
import { inputDigest, redactedIntent } from '../model';
import { actorId, at, context, facilityId, link, linked, otherId, patientId, referralId, requestId, scope, source } from './fixtures';
const runtime = window.__HMS_RUNTIME_CONFIG__, originalFetch = globalThis.fetch;
const principal = { id: actorId, facility_id: facilityId, active_profile: 'hospital' };
const root = '/api/v2/patients/{patient_id}/referrals/{referral_id}/consultation';
const params = { patient_id: patientId, referral_id: referralId };
const payload = { client_request_id: requestId, expected_link_version: 0, expected_context_token: context.context_token, source, restricted_record_override: { reason_code: 'Synthetic intake override', reason_note: 'Synthetic private override note' } };
let token, receipt;
const json = (value, status = 200) => new Response(JSON.stringify(status === 200 ? { data: value } : { error: { code: 'referral_consultation_unavailable', details: {} } }), { status, headers: { 'content-type': 'application/json' } });
function bind() { configureV2ApiClient({ getAccessToken: () => token, getFacilityCode: () => 'QA', canRefreshSession: () => false }); const binding = { transportScope: getV2ClientScopeKey(), authorityScope: 'synthetic-consultation-authority', principal }; bindNetworkAccessGuard(binding).update({ confirmed: true, decision: { access_allowed: true, read_only: false, classification: 'onsite', policy_version: 1 } }); activateWriteUncertainty(principal, { authority: binding.authorityScope, transport: binding.transportScope }); }
const post = (body = payload, pathParams = params, suffix = '/start') => v2Request({ method: 'POST', path: root + suffix, pathParams, body });
const state = () => getWriteUncertaintySnapshot().entries;
async function lose() { fetch.mockRejectedValueOnce(new TypeError('Synthetic reply lost')); await expect(post()).rejects.toMatchObject({ status: 0 }); await vi.waitFor(() => expect(state()).toHaveLength(1)); }
async function read(value = linked, suffix = '', extra = {}) { fetch.mockResolvedValueOnce(json(value)); return (await v2Request({ path: root + suffix, pathParams: { ...params, ...extra } })).data; }
async function prepare(value = linked) { const checked = await read(value); return { proof: await consultationManualReview('prepare', { scope, context: checked }), context: checked }; }
beforeEach(async () => { vi.stubGlobal('crypto', webcrypto); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' }; __resetV2ApiClientForTests(); token = 'synthetic-consultation-token'; bind(); globalThis.fetch = vi.fn(); receipt = { client_request_id: requestId, replayed: false, recorded_at: at, input_digest: await inputDigest(payload), reviewed_input: redactedIntent(payload), link }; });
afterEach(() => { __resetV2ApiClientForTests(); vi.unstubAllGlobals(); globalThis.fetch = originalFetch; window.__HMS_RUNTIME_CONFIG__ = runtime; });

it('persists only opaque recovery metadata and permits only an unchanged exact supported start after a reload', async () => {
  await lose(); const stored = sessionStorage.getItem(WRITE_UNCERTAINTY_KEY);
  for (const secret of [patientId, referralId, token, context.context_token, payload.restricted_record_override.reason_note, payload.restricted_record_override.reason_code]) expect(stored).not.toContain(secret);
  resetWriteUncertaintyForTests({ preserveStorage: true }); bind();
  for (const [body, pathParams] of [[{ ...payload, client_request_id: otherId }, params], [{ ...payload, restricted_record_override: { ...payload.restricted_record_override, reason_note: 'Different synthetic note' } }, params], [payload, { ...params, referral_id: otherId }]]) await expect(post(body, pathParams)).rejects.toMatchObject({ data: { error: { code: 'write_review_required' } } });
  fetch.mockResolvedValueOnce(json(receipt)); await post(); expect(fetch).toHaveBeenCalledTimes(2); expect(state()).toHaveLength(0);
});
it('never makes a context read automatic original-request evidence', async () => { await lose(); await read(); expect(state()[0].reviewed).toBe(false); });
it.each(['uuid', 'patient', 'referral', 'actor', 'digest', 'override'])('refuses wrong-but-valid %s original receipt evidence', async fault => {
  await lose(); const bad = structuredClone(receipt); let requested = requestId;
  if (fault === 'uuid') requested = otherId;
  if (fault === 'patient') bad.link.patient_id = otherId;
  if (fault === 'referral') bad.link.referral_id = otherId;
  if (fault === 'actor') bad.link.recorded_by_user_id = otherId;
  if (fault === 'digest') bad.input_digest = 'bad';
  if (fault === 'override') bad.reviewed_input.restricted_record_override.reason_note = 'Synthetic leaked note';
  await read(bad, '/requests/{request_id}', { request_id: requested }); expect(state()[0].reviewed).toBe(false);
});
it('only the original actor-bound UUID receipt supplies saved-record evidence with a separate acknowledgment', async () => { await lose(); await read(receipt, '/requests/{request_id}', { request_id: requestId }); expect(state()[0].reviewed).toBe(true); expect(state()).toHaveLength(1); });
it('requires two distinct actual current reads and a single-use explicit manual proof', async () => {
  await lose(); await expect(consultationManualReview('prepare', { scope, context: linked })).rejects.toThrow(); const first = await prepare();
  await expect(consultationManualReview('acknowledge', { scope, proof: first.proof, context: first.context })).rejects.toThrow(); expect(state()).toHaveLength(1);
  const second = await prepare(), fresh = await read(); await consultationManualReview('acknowledge', { scope, proof: second.proof, context: fresh }); expect(state()).toHaveLength(0);
  await expect(consultationManualReview('acknowledge', { scope, proof: second.proof, context: fresh })).rejects.toThrow();
});
it.each(['scope', 'version', 'token', 'authority', 'cancel'])('preserves the barrier after a %s transition', async fault => {
  await lose(); const review = await prepare(); let target = scope, value = linked;
  if (fault === 'scope') target = { ...scope, referralId: otherId };
  if (fault === 'version') value = context;
  if (fault === 'token') value = { ...linked, context_token: 'c'.repeat(64) };
  if (fault === 'authority') { token = 'synthetic-new-proof'; bind(); await vi.waitFor(() => expect(state()).toHaveLength(1)); }
  if (fault === 'cancel') await consultationManualReview('cancel', { proof: review.proof });
  const fresh = await read(value); await expect(consultationManualReview('acknowledge', { scope: target, proof: review.proof, context: fresh })).rejects.toThrow(); expect(state()).toHaveLength(1);
});
it('allows honest no-link review without inventing an original start', async () => { await lose(); const review = await prepare(context), fresh = await read(context); await consultationManualReview('acknowledge', { scope, proof: review.proof, context: fresh }); expect(state()).toHaveLength(0); });
it('cannot manually release while the exact original retry remains active', async () => {
  await lose(); const review = await prepare(), fresh = await read(); let resolve;
  fetch.mockImplementationOnce(() => new Promise(done => { resolve = done; })); const pending = post(); await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
  await expect(consultationManualReview('acknowledge', { scope, proof: review.proof, context: fresh })).rejects.toThrow(); resolve(json(receipt)); await pending; expect(state()).toHaveLength(0);
});
it('does not create exact retry eligibility for unsupported suffixes', async () => { fetch.mockRejectedValueOnce(new TypeError('Synthetic reply lost')); await expect(post(payload, params, '/start/extra')).rejects.toBeDefined(); await expect(post(payload, params, '/start/extra')).rejects.toMatchObject({ status: 409 }); expect(fetch).toHaveBeenCalledTimes(1); });
it.each(['denial', 'ABA'])('rejects %s during asynchronous acknowledgment digest without losing the original barrier', async change => {
  await lose(); const review = await prepare(), fresh = await read(); const original = crypto.subtle.digest.bind(crypto.subtle); let release, entered, intercept = true;
  const began = new Promise(resolve => { entered = resolve; }), paused = new Promise(resolve => { release = resolve; });
  const spy = vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (algorithm, bytes) => { if (intercept && new TextDecoder().decode(bytes).includes('"context_token"')) { intercept = false; entered(); await paused; } return original(algorithm, bytes); });
  try {
    const result = consultationManualReview('acknowledge', { scope, proof: review.proof, context: fresh }).then(() => 'released', () => 'rejected'); await began;
    if (change === 'denial') { fetch.mockResolvedValueOnce(json(null, 403)); await expect(v2Request({ path: root, pathParams: params })).rejects.toMatchObject({ status: 403 }); }
    else { await read({ ...linked, context_token: 'c'.repeat(64) }); await read(); }
    release(); expect(await result).toBe('rejected'); expect(state()).toHaveLength(1);
  } finally { release(); spy.mockRestore(); }
});
it('refuses a success dispatched before403 when response JSON arrives after denial', async () => {
  await lose(); let deliver, entered; const body = new Promise(resolve => { deliver = resolve; }), began = new Promise(resolve => { entered = resolve; });
  fetch.mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: () => { entered(); return body; } });
  const older = v2Request({ path: root, pathParams: params }); await began;
  fetch.mockResolvedValueOnce(json(null, 403)); await expect(v2Request({ path: root, pathParams: params })).rejects.toMatchObject({ status: 403 }); deliver({ data: linked }); const stale = (await older).data;
  await expect(consultationManualReview('prepare', { scope, context: stale })).rejects.toThrow(); expect(state()).toHaveLength(1);
});

it.each(['unknown', null, 'consultation/extra'])('rejects a nonclosed manual protocol selector (%s) without releasing any barrier', async protocol => {
  await lose(); await expect(referralResponseManualReview('candidate', { scope }, protocol)).rejects.toThrow(); expect(state()).toHaveLength(1); expect(state()[0].reviewed).toBe(false);
});
