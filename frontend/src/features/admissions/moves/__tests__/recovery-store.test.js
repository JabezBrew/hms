import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { configureV2ApiClient, __resetV2ApiClientForTests, getV2ClientScopeKey, v2Request } from '@/lib/api/v2/client';
import { bindNetworkAccessGuard } from '@/lib/api/v2/networkAccessGuard';
import { acknowledgeWriteReview, activateWriteUncertainty, admissionMoveManualReview, getWriteUncertaintySnapshot, resetWriteUncertaintyForTests, WRITE_UNCERTAINTY_KEY } from '@/lib/api/v2/writeUncertainty';
import { actorId, command, context, facilityId, ids, json, receipt, scope } from './fixtures';
const originalFetch = globalThis.fetch, runtime = window.__HMS_RUNTIME_CONFIG__;
const root = '/api/v2/patients/{patient_id}/chronicle/admissions/{admission_case_id}';
const params = { patient_id: scope.patientId, admission_case_id: scope.caseId }, principal = { id: actorId, facility_id: facilityId, active_profile: 'hospital' };
let token;
function bind() { configureV2ApiClient({ getAccessToken: () => token, getFacilityCode: () => 'QA', canRefreshSession: () => false }); const transport = getV2ClientScopeKey(); bindNetworkAccessGuard({ transportScope: transport, authorityScope: 'synthetic-move-authority', principal }).update({ confirmed: true, decision: { access_allowed: true, read_only: false, classification: 'onsite', policy_version: 1 } }); activateWriteUncertainty(principal, { authority: 'synthetic-move-authority', transport }); }
const entries = () => getWriteUncertaintySnapshot().entries;
const post = (payload = command().payload, pathParams = params, suffix = '/moves') => v2Request({ method: 'POST', path: root + suffix, pathParams, body: payload });
async function lose() { fetch.mockRejectedValueOnce(new TypeError('Synthetic lost move response')); await expect(post()).rejects.toMatchObject({ status: 0 }); await vi.waitFor(() => expect(entries()).toHaveLength(1)); }
async function read(value = context(), suffix = '/placement', extra = {}) { fetch.mockResolvedValueOnce(json({ data: value })); return (await v2Request({ path: root + suffix, pathParams: { ...params, ...extra } })).data; }
async function prepare() { const current = await read(); return { current, proof: await admissionMoveManualReview('prepare', { scope, context: current }) }; }
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); __resetV2ApiClientForTests(); token = 'synthetic-move-token'; window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' }; bind(); globalThis.fetch = vi.fn(); });
afterEach(() => { __resetV2ApiClientForTests(); vi.unstubAllGlobals(); globalThis.fetch = originalFetch; window.__HMS_RUNTIME_CONFIG__ = runtime; });
it('retains only opaque recovery after lost RAM and missing original receipt, then permits an honest explicit current-placement review', async () => {
  await lose(); const stored = sessionStorage.getItem(WRITE_UNCERTAINTY_KEY);
  for (const secret of [scope.patientId, scope.caseId, command().payload.reason, context().placement_token, token]) expect(stored).not.toContain(secret);
  resetWriteUncertaintyForTests({ preserveStorage: true }); bind();
  fetch.mockResolvedValueOnce(json({ error: { code: 'admission_move_not_found' } }, 404)); await expect(v2Request({ path: root + '/move-requests/{request_id}', pathParams: { ...params, request_id: command().payload.client_request_id } })).rejects.toMatchObject({ status: 404 });
  await expect(post({ ...command().payload, client_request_id: ids[20] })).rejects.toMatchObject({ status: 409 });
  const reviewed = await prepare(); expect(entries()[0].reviewed).toBe(false);
  const fresh = await read(); await admissionMoveManualReview('acknowledge', { scope, proof: reviewed.proof, context: fresh }); expect(entries()).toHaveLength(0);
  fetch.mockResolvedValueOnce(json({ data: receipt() })); await post({ ...command().payload, client_request_id: ids[20] }); expect(entries()).toHaveLength(0);
});
it('never automatically acknowledges placement, destination, history or ordinary exact move reads', async () => { await lose(); await read(); await read([], '/move-destinations'); await read([], '/moves'); await read(receipt().movement, '/moves/{move_id}', { move_id: ids[10] }); expect(entries()[0].reviewed).toBe(false); });
it('requires actual transport reads, a separate newer read and a single-use explicit gesture', async () => {
  await lose(); await expect(admissionMoveManualReview('prepare', { scope, context: context() })).rejects.toThrow(); const first = await prepare();
  await expect(admissionMoveManualReview('acknowledge', { scope, proof: first.proof, context: first.current })).rejects.toThrow(); expect(entries()).toHaveLength(1);
  const second = await prepare(), fresh = await read(); await admissionMoveManualReview('acknowledge', { scope, proof: second.proof, context: fresh });
  await expect(admissionMoveManualReview('acknowledge', { scope, proof: second.proof, context: fresh })).rejects.toThrow();
});
it.each(['case', 'patient', 'token', 'revision', 'authority', 'cancel'])('refuses prepared review after a %s transition', async fault => {
  await lose(); const reviewed = await prepare(); let target = scope, value = context();
  if (fault === 'case') target = { ...scope, caseId: ids[20] }; if (fault === 'patient') target = { ...scope, patientId: ids[20] };
  if (fault === 'token') value = context({ placement_token: 'd'.repeat(64) }); if (fault === 'revision') value = context({ placement_revision: 5 });
  if (fault === 'authority') { token = 'synthetic-new-token'; bind(); await vi.waitFor(() => expect(entries()).toHaveLength(1)); }
  if (fault === 'cancel') await admissionMoveManualReview('cancel', { proof: reviewed.proof });
  const fresh = await read(value); await expect(admissionMoveManualReview('acknowledge', { scope: target, proof: reviewed.proof, context: fresh })).rejects.toThrow(); expect(entries()).toHaveLength(1);
});
it('does not resurrect a prepared review through actual placement A→B→A reads', async () => { await lose(); const reviewed = await prepare(); await read(context({ placement_token: 'd'.repeat(64) })); const restored = await read(); await expect(admissionMoveManualReview('acknowledge', { scope, proof: reviewed.proof, context: restored })).rejects.toThrow(); });
it('invalidates an earlier successful read and review after a later current403', async () => { await lose(); const reviewed = await prepare(), prior = await read(); fetch.mockResolvedValueOnce(json({ error: { code: 'admission_move_unavailable' } }, 403)); await expect(v2Request({ path: root + '/placement', pathParams: params })).rejects.toMatchObject({ status: 403 }); await expect(admissionMoveManualReview('acknowledge', { scope, proof: reviewed.proof, context: prior })).rejects.toThrow(); expect(entries()).toHaveLength(1); });
it('invalidates old review after current403 during an active exact retry and retains the earlier marker after a definite rejection', async () => {
  await lose(); const reviewed = await prepare(), prior = await read(); let resolve;
  fetch.mockImplementationOnce(() => new Promise(done => { resolve = done; })); const pending = post(); await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
  fetch.mockResolvedValueOnce(json({ error: { code: 'admission_move_unavailable' } }, 403)); await expect(v2Request({ path: root + '/placement', pathParams: params })).rejects.toMatchObject({ status: 403 });
  resolve(json({ error: { code: 'invalid_admission_move' } }, 400)); await expect(pending).rejects.toMatchObject({ status: 400 }); await expect(admissionMoveManualReview('acknowledge', { scope, proof: reviewed.proof, context: prior })).rejects.toThrow(); expect(entries()).toHaveLength(1);
});
it.each(['request', 'case', 'actor'])('does not accept a wrong-but-valid %s receipt as original request evidence', async fault => { await lose(); const saved = receipt(); let id = saved.client_request_id; if (fault === 'request') id = ids[20]; if (fault === 'case') saved.movement.admission_case_id = ids[20]; if (fault === 'actor') saved.movement.recorded_by_user_id = ids[20]; await read(saved, '/move-requests/{request_id}', { request_id: id }); expect(entries()[0].reviewed).toBe(false); });
it('does not create retry eligibility for unsupported suffixes', async () => { fetch.mockRejectedValueOnce(new TypeError('Synthetic lost response')); await expect(post(command().payload, params, '/moves/extra')).rejects.toBeDefined(); await expect(post(command().payload, params, '/moves/extra')).rejects.toMatchObject({ status: 409 }); expect(fetch).toHaveBeenCalledTimes(1); });
it.each(['denial', 'ABA'])('retains the barrier when %s invalidates review during acknowledgement body hashing', async change => {
  await lose(); const reviewed = await prepare(), fresh = await read();
  const actual = crypto.subtle.digest.bind(crypto.subtle); let release, entered; let gate = true;
  const started = new Promise(resolve => { entered = resolve; }); const pendingDigest = new Promise(resolve => { release = resolve; });
  const spy = vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (algorithm, bytes) => {
    if (gate && new TextDecoder().decode(bytes).includes('"placement_token"')) { gate = false; entered(); await pendingDigest; }
    return actual(algorithm, bytes);
  });
  try {
    const result = admissionMoveManualReview('acknowledge', { scope, proof: reviewed.proof, context: fresh }).then(() => 'released', () => 'rejected');
    await started;
    if (change === 'denial') { fetch.mockResolvedValueOnce(json({ error: { code: 'admission_move_unavailable' } }, 403)); await expect(v2Request({ path: root + '/placement', pathParams: params })).rejects.toMatchObject({ status: 403 }); }
    else { await read(context({ placement_token: 'd'.repeat(64) })); await read(); }
    release(); expect(await result).toBe('rejected'); expect(entries()).toHaveLength(1);
  } finally { release(); spy.mockRestore(); }
});
it('cannot turn an older successful read into new review evidence by finishing its digest after a current403', async () => {
  await lose(); const actual = crypto.subtle.digest.bind(crypto.subtle); let release, entered, gate = true;
  const started = new Promise(resolve => { entered = resolve; }), pendingDigest = new Promise(resolve => { release = resolve; });
  const spy = vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (algorithm, bytes) => { if (gate && new TextDecoder().decode(bytes).includes('"placement_token"')) { gate = false; entered(); await pendingDigest; } return actual(algorithm, bytes); });
  try {
    const pending = read(); await started; fetch.mockResolvedValueOnce(json({ error: { code: 'admission_move_unavailable' } }, 403)); await expect(v2Request({ path: root + '/placement', pathParams: params })).rejects.toMatchObject({ status: 403 });
    release(); const stale = await pending; await expect(admissionMoveManualReview('prepare', { scope, context: stale })).rejects.toThrow(); expect(entries()).toHaveLength(1);
  } finally { release(); spy.mockRestore(); }
});
it('refuses pre-denial dispatched placement evidence even when successful response JSON arrives after current403', async () => {
  await lose(); let deliver, entered;
  const body = new Promise(resolve => { deliver = resolve; }), started = new Promise(resolve => { entered = resolve; });
  fetch.mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: () => { entered(); return body; } });
  const older = v2Request({ path: root + '/placement', pathParams: params }); await started;
  fetch.mockResolvedValueOnce(json({ error: { code: 'admission_move_unavailable' } }, 403)); await expect(v2Request({ path: root + '/placement', pathParams: params })).rejects.toMatchObject({ status: 403 });
  deliver({ data: context() }); const stale = (await older).data;
  await expect(admissionMoveManualReview('prepare', { scope, context: stale })).rejects.toThrow(); expect(entries()).toHaveLength(1);
});

it.each(['unchanged', 'denial', 'authority ABA', 'digest denial'])('requires a current receipt dispatch after %s before acknowledging an unknown move', async change => {
  await lose();
  let deliver, entered;
  const body = new Promise(resolve => { deliver = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  fetch.mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: () => { entered(); return body; } });
  const pending = v2Request({ path: root + '/move-requests/{request_id}', pathParams: { ...params, request_id: command().payload.client_request_id } });
  await started;
  const deny = async () => {
    fetch.mockResolvedValueOnce(json({ error: { code: 'admission_move_unavailable' } }, 403));
    await expect(v2Request({ path: root + '/placement', pathParams: params })).rejects.toMatchObject({ status: 403 });
  };
  let spy, release;
  try {
    if (change === 'denial') await deny();
    if (change === 'authority ABA') {
      const original = token; token = 'synthetic-other-transport'; bind();
      await vi.waitFor(() => expect(entries()).toHaveLength(1));
      token = original; bind(); await vi.waitFor(() => expect(entries()).toHaveLength(1));
    }
    if (change === 'digest denial') {
      let begin; const digestStarted = new Promise(resolve => { begin = resolve; });
      const gate = new Promise(resolve => { release = resolve; });
      const actual = crypto.subtle.digest.bind(crypto.subtle); let first = true;
      spy = vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (algorithm, bytes) => {
        if (first && new TextDecoder().decode(bytes).includes(':family:')) { first = false; begin(); await gate; }
        return actual(algorithm, bytes);
      });
      deliver({ data: receipt() }); await digestStarted; await deny(); release();
    } else deliver({ data: receipt() });
    await pending;
    const entry = entries()[0]; expect(entry.reviewed).toBe(change === 'unchanged');
    if (change === 'unchanged') { await acknowledgeWriteReview(entry.id, principal); expect(entries()).toHaveLength(0); }
    else { await expect(acknowledgeWriteReview(entry.id, principal)).rejects.toMatchObject({ status: 409 }); expect(entries()).toHaveLength(1); }
  } finally { release?.(); spy?.mockRestore(); }
});

it('invalidates an already published receipt review after a current denial but accepts a fresh authorized receipt', async () => {
  await lose(); await read(receipt(), '/move-requests/{request_id}', { request_id: command().payload.client_request_id });
  expect(entries()[0].reviewed).toBe(true);
  fetch.mockResolvedValueOnce(json({ error: { code: 'admission_move_unavailable' } }, 403));
  await expect(v2Request({ path: root + '/placement', pathParams: params })).rejects.toMatchObject({ status: 403 });
  const entry = entries()[0]; expect(entry.reviewed).toBe(false);
  await expect(acknowledgeWriteReview(entry.id, principal)).rejects.toMatchObject({ status: 409 });
  expect(entries()).toHaveLength(1);
  await read(receipt(), '/move-requests/{request_id}', { request_id: command().payload.client_request_id });
  expect(entries()[0].reviewed).toBe(true); await acknowledgeWriteReview(entry.id, principal); expect(entries()).toHaveLength(0);
});
