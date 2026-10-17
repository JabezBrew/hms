import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { __resetV2ApiClientForTests, configureV2ApiClient, getV2ClientScopeKey, v2Request } from '@/lib/api/v2/client';
import { bindNetworkAccessGuard } from '@/lib/api/v2/networkAccessGuard';
import { activateWriteUncertainty, getWriteUncertaintySnapshot, referralResponseManualReview, resetWriteUncertaintyForTests, WRITE_UNCERTAINTY_KEY } from '@/lib/api/v2/writeUncertainty';
import { actorId, context, laterId, metadata, patientId, receipt, referralId, requestId, revision, revisionId, scope } from './fixtures';
const runtime = window.__HMS_RUNTIME_CONFIG__, originalFetch = globalThis.fetch;
const principal = { id: actorId, facility_id: laterId, active_profile: 'hospital' };
const root = '/api/v2/patients/{patient_id}/referrals/{referral_id}/response';
const params = { patient_id: patientId, referral_id: referralId };
const payload = { client_request_id: requestId, expected_version: 0, expected_context_token: context.context_token, operation: 'save_draft', specialist_notes: revision.specialist_notes, recommendations: revision.recommendations, amendment_reason: null };
const current = { ...context, version: 1, response: revision };
const json = (data, status = 200) => new Response(JSON.stringify(status === 200 ? { data } : { error: { code: 'referral_response_unavailable', details: {} } }), { status, headers: { 'content-type': 'application/json' } });
let token;
function bind() { configureV2ApiClient({ getAccessToken: () => token, getFacilityCode: () => 'QA', canRefreshSession: () => false }); const binding = { transportScope: getV2ClientScopeKey(), authorityScope: 'synthetic-referral-authority', principal }; bindNetworkAccessGuard(binding).update({ confirmed: true, decision: { access_allowed: true, read_only: false, classification: 'onsite', policy_version: 1 } }); activateWriteUncertainty(principal, { authority: binding.authorityScope, transport: binding.transportScope }); }
const post = (body = payload, pathParams = params, suffix = '/commands') => v2Request({ method: 'POST', path: root + suffix, pathParams, body });
const state = () => getWriteUncertaintySnapshot().entries;
async function lose() { fetch.mockRejectedValueOnce(new TypeError('Synthetic response lost')); await expect(post()).rejects.toMatchObject({ status: 0 }); await vi.waitFor(() => expect(state()).toHaveLength(1)); }
async function read(suffix = '', data = current, extra = {}, pathParams = params) { fetch.mockResolvedValueOnce(json(data)); return (await v2Request({ path: root + suffix, pathParams: { ...pathParams, ...extra } })).data; }
async function prepare() { await read(); const version = await read('/versions/{version_id}', revision, { version_id: revisionId }); const fresh = await read(); return { proof: await referralResponseManualReview('prepare', { scope, context: fresh, version }), context: fresh }; }
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' }; __resetV2ApiClientForTests(); token = 'synthetic-referral-token'; bind(); globalThis.fetch = vi.fn(); });
afterEach(() => { __resetV2ApiClientForTests(); vi.unstubAllGlobals(); globalThis.fetch = originalFetch; window.__HMS_RUNTIME_CONFIG__ = runtime; });
it('allows only the same exact supported command after unknown save, without persisting clinical bodies or scope identities', async () => {
  await lose(); const stored = sessionStorage.getItem(WRITE_UNCERTAINTY_KEY);
  for (const value of [patientId, referralId, revision.specialist_notes, revision.recommendations, context.context_token, token]) expect(stored).not.toContain(value);
  resetWriteUncertaintyForTests({ preserveStorage: true }); bind();
  for (const [body, pathParams] of [[{ ...payload, client_request_id: laterId }, params], [{ ...payload, specialist_notes: 'Changed complete synthetic response' }, params], [payload, { ...params, referral_id: laterId }]]) await expect(post(body, pathParams)).rejects.toMatchObject({ data: { error: { code: 'write_review_required' } } });
  fetch.mockResolvedValueOnce(json(receipt)); await post(); expect(fetch).toHaveBeenCalledTimes(2); expect(state()).toHaveLength(0);
});
it('never makes context, history metadata or an unrelated older version saved-record evidence', async () => {
  await lose(); await read(); await read('/history', [metadata()]); await read('/versions/{version_id}', revision, { version_id: revisionId });
  expect(state()[0].reviewed).toBe(false);
  const newer = { ...current, version: 2, response: { ...revision, id: laterId, version: 2 } }; const fresh = await read('', newer); const old = await read('/versions/{version_id}', revision, { version_id: revisionId }); const latest = await read('', newer);
  await expect(referralResponseManualReview('prepare', { scope, context: latest, version: old })).rejects.toThrow(/Review/); expect(fresh.version).toBe(2); expect(state()[0].reviewed).toBe(false);
});
it.each(['uuid', 'patient', 'referral', 'actor'])('refuses wrong-but-valid %s receipt metadata as original-request evidence', async fault => {
  await lose(); const bad = structuredClone(receipt); let requested = requestId;
  if (fault === 'uuid') requested = laterId;
  if (fault === 'patient') bad.response.patient_id = laterId;
  if (fault === 'referral') bad.response.referral_id = laterId;
  if (fault === 'actor') bad.response.recorded_by_user_id = laterId;
  await read('/requests/{request_id}', bad, { request_id: requested }); expect(state()[0].reviewed).toBe(false);
});
it('accepts only the actual actor-bound original receipt UUID while retaining separate acknowledgment', async () => {
  await lose(); await read('/requests/{request_id}', receipt, { request_id: requestId }); expect(state()[0].reviewed).toBe(true); expect(state()).toHaveLength(1);
});
it('requires transport-stamped current and exact-version reads followed by a separate new current read and explicit manual release', async () => {
  await lose(); await expect(referralResponseManualReview('prepare', { scope, context: current, version: revision })).rejects.toThrow();
  const review = await prepare(); expect(state()[0].reviewed).toBe(false);
  await expect(referralResponseManualReview('acknowledge', { scope, proof: review.proof, context: review.context })).rejects.toThrow(); expect(state()).toHaveLength(1);
  const again = await prepare(); const fresh = await read(); await referralResponseManualReview('acknowledge', { scope, proof: again.proof, context: fresh }); expect(state()).toHaveLength(0);
  await expect(referralResponseManualReview('acknowledge', { scope, proof: again.proof, context: fresh })).rejects.toThrow();
  fetch.mockResolvedValueOnce(json(receipt)); await post({ ...payload, client_request_id: laterId, expected_version: 1, expected_context_token: 'b'.repeat(64) }); expect(state()).toHaveLength(0);
});
it.each(['scope', 'version', 'token', 'authority', 'cancel'])('invalidates manual release after a %s binding transition', async fault => {
  await lose(); const review = await prepare(); let target = scope; let value = current;
  if (fault === 'scope') target = { ...scope, referralId: laterId };
  if (fault === 'version') value = { ...current, version: 2, response: { ...revision, id: laterId, version: 2 } };
  if (fault === 'token') value = { ...current, context_token: 'b'.repeat(64) };
  if (fault === 'authority') { token = 'synthetic-new-proof'; bind(); await vi.waitFor(() => expect(state()).toHaveLength(1)); }
  if (fault === 'cancel') await referralResponseManualReview('cancel', { proof: review.proof });
  const fresh = await read('', value);
  await expect(referralResponseManualReview('acknowledge', { scope: target, proof: review.proof, context: fresh })).rejects.toThrow(); expect(state()).toHaveLength(1);
});
it('a failed current403 read cannot acknowledge an earlier manually reviewed state', async () => {
  await lose(); const review = await prepare(); fetch.mockResolvedValueOnce(json(null, 403)); await expect(v2Request({ path: root, pathParams: params })).rejects.toMatchObject({ status: 403 });
  await expect(referralResponseManualReview('acknowledge', { scope, proof: review.proof, context: review.context })).rejects.toThrow(); expect(state()).toHaveLength(1);
});
it('cannot manually release while the exact original retry is still active', async () => {
  await lose(); const review = await prepare(); const fresh = await read(); let resolve; fetch.mockImplementationOnce(() => new Promise(done => { resolve = done; })); const pending = post(); await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
  await expect(referralResponseManualReview('acknowledge', { scope, proof: review.proof, context: fresh })).rejects.toThrow(); resolve(json(receipt)); await pending; expect(state()).toHaveLength(0);
});
it('allows honest explicit current-state review when no response exists, without inventing an original result', async () => {
  await lose(); const fresh = await read('', context); const proof = await referralResponseManualReview('prepare', { scope, context: fresh, version: null }); expect(state()).toHaveLength(1);
  const rechecked = await read('', context); await referralResponseManualReview('acknowledge', { scope, proof, context: rechecked }); expect(state()).toHaveLength(0);
});
it('does not create exact-retry eligibility for unsupported command suffixes', async () => {
  fetch.mockRejectedValueOnce(new TypeError('Synthetic response lost')); await expect(post(payload, params, '/commands/extra')).rejects.toBeDefined(); await expect(post(payload, params, '/commands/extra')).rejects.toMatchObject({ status: 409 }); expect(fetch).toHaveBeenCalledTimes(1);
});
it('invalidates a prepared proof and already-successful current read after a later current403', async () => {
  await lose(); const review = await prepare(); const successful = await read(); fetch.mockResolvedValueOnce(json(null, 403)); await expect(v2Request({ path: root, pathParams: params })).rejects.toMatchObject({ status: 403 });
  await expect(referralResponseManualReview('acknowledge', { scope, proof: review.proof, context: successful })).rejects.toThrow(); expect(state()).toHaveLength(1);
});
it('cannot resurrect a previous review after actual context A→B→A reads', async () => {
  await lose(); const review = await prepare(); await read('', { ...current, context_token: 'b'.repeat(64) }); const restored = await read();
  await expect(referralResponseManualReview('acknowledge', { scope, proof: review.proof, context: restored })).rejects.toThrow(); expect(state()).toHaveLength(1);
});
it('invalidates prior manual proof on current403 even while the exact retry is active, preserving its earlier barrier after a definite rejection', async () => {
  await lose(); const review = await prepare(); const priorCurrent = await read(); let resolve;
  fetch.mockImplementationOnce(() => new Promise(done => { resolve = done; })); const pending = post(); await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
  fetch.mockResolvedValueOnce(json(null, 403)); await expect(v2Request({ path: root, pathParams: params })).rejects.toMatchObject({ status: 403 });
  resolve(json(null, 400)); await expect(pending).rejects.toMatchObject({ status: 400 });
  await expect(referralResponseManualReview('acknowledge', { scope, proof: review.proof, context: priorCurrent })).rejects.toThrow(); expect(state()).toHaveLength(1);
});
