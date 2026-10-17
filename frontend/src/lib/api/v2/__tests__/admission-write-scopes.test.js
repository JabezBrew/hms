import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const ids = Array.from({ length: 7 }, (_, i) => `72000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [actor, facility, patient, admission, course, requestId, advisory] = ids;
const principal = { id: actor, facility_id: facility, active_profile: 'hospital' };
const root = '/api/v2/patients/{patient_id}/chronicle/admissions/{admission_case_id}/medication-courses';
const resolved = `/api/v2/patients/${patient}/chronicle/admissions/${admission}/medication-courses`;
const pathParams = { patient_id: patient, admission_case_id: admission, course_id: course };
const body = { client_request_id: requestId, reason: 'Synthetic private decision' };
const oldRuntime = window.__HMS_RUNTIME_CONFIG__; const oldFetch = globalThis.fetch;
let client; let guard; let ledger; let token; let authority;
const json = (data) => new Response(JSON.stringify({ data }), { headers: { 'content-type': 'application/json' } });
async function setup() {
  [client, guard, ledger] = await Promise.all([import('../client'), import('../networkAccessGuard'), import('../writeUncertainty')]);
  client.__resetV2ApiClientForTests(); bind();
}
function bind() {
  client.configureV2ApiClient({ getAccessToken: () => token, getFacilityCode: () => 'QA', canRefreshSession: () => false });
  guard.bindNetworkAccessGuard({ transportScope: client.getV2ClientScopeKey(), authorityScope: authority, principal }).update({ confirmed: true, decision: { access_allowed: true, read_only: false, classification: 'onsite', policy_version: 1 } });
  ledger.activateWriteUncertainty(principal);
}
const write = () => client.v2Request({ method: 'POST', path: `${root}/{course_id}/stop`, pathParams, body });
function delayedClassifier() {
  let release; let entered; const started = new Promise((resolve) => { entered = resolve; }); const gate = new Promise((resolve) => { release = resolve; });
  vi.doMock('../admissionWriteScopes', async () => { entered(); await gate; return vi.importActual('../admissionWriteScopes'); });
  return { started, release };
}
beforeEach(() => {
  vi.resetModules(); vi.stubGlobal('crypto', webcrypto); token = 'synthetic-initial-token'; authority = 'synthetic-authority'; globalThis.fetch = vi.fn();
  window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' };
  sessionStorage.clear();
});
afterEach(() => { client?.__resetV2ApiClientForTests(); vi.doUnmock('../admissionWriteScopes'); vi.resetModules(); vi.unstubAllGlobals(); globalThis.fetch = oldFetch; window.__HMS_RUNTIME_CONFIG__ = oldRuntime; });
it('classifies only exact UUID-bound admission protocols and preserves lean-read exclusions', async () => {
  const { classifyAdmissionWriteScope: classify } = await import('../admissionWriteScopes');
  expect(classify(`${resolved}/${course}/stop`, pathParams)).toMatchObject({ primary: `treatment-course:${patient}:${admission}:${course}`, retryTemplate: 'POST /api/v2/patients/:id/chronicle/admissions/:id/medication-courses/:id/stop' });
  expect(classify(`${resolved}/${course}/supply-windows`, pathParams).retryTemplate).toMatch(/supply-windows$/);
  expect(classify(resolved, pathParams).excludeRead).toBe(true); expect(classify(`${resolved}/context`, pathParams).excludeRead).toBe(true);
  expect(classify(`/api/v2/patients/${patient}/chronicle/admission-advisory-cases`).excludeRead).toBe(true);
  const advisories = resolved.replace('medication-courses', 'advisories');
  expect(classify(advisories, { case_id: admission })).toMatchObject({ primary: admission, excludeRead: true, retryTemplate: 'POST /api/v2/patients/:id/chronicle/admissions/:id/advisories' });
  expect(classify(`${advisories}/${advisory}/decision`, { case_id: admission }).retryTemplate).toMatch(/advisories\/:id\/decision$/);
  expect(classify(`${advisories}/${advisory}`, { case_id: ids[6] }).primary).toBeNull();
  for (const path of [`${resolved}/${course}/stop/extra`, resolved.replace(patient, 'private-patient'), resolved.replace(admission, 'not-a-uuid'), `${resolved}/private-course/stop`, `/extra${resolved}/${course}/stop`, `${advisories}/${advisory}/decision/extra`]) expect(classify(path, pathParams)).toBeNull();
});
it('fails before dispatch on a genuine deferred chunk rejection while leaving reads available', async () => {
  vi.doMock('../admissionWriteScopes', () => { throw new TypeError('Synthetic chunk unavailable'); }); await setup();
  await expect(write()).rejects.toMatchObject({ status: 409, data: { error: { code: 'write_review_check_unavailable' } } });
  expect(fetch).not.toHaveBeenCalled(); expect(ledger.getWriteUncertaintySnapshot().entries).toEqual([]);
  fetch.mockResolvedValueOnce(json({ id: course })); await expect(client.v2Request({ path: `${root}/{course_id}`, pathParams })).resolves.toEqual({ data: { id: course } }); expect(fetch).toHaveBeenCalledTimes(1);
});
it.each(['transport', 'authority'])('does not dispatch a staged command when actual %s changes during the real classifier load', async (changed) => {
  const delayed = delayedClassifier(); await setup(); const pending = write().catch((error) => error); await delayed.started;
  if (changed === 'transport') token = 'synthetic-new-authority-token'; else authority = 'synthetic-revoked-authority'; bind(); delayed.release();
  await expect(pending).resolves.toMatchObject({ status: 403, data: { error: { code: 'request_scope_changed' } } }); expect(fetch).not.toHaveBeenCalled(); expect(ledger.getWriteUncertaintySnapshot().entries).toEqual([]);
});
it('rechecks earlier uncertainty after a deferred classifier resolves instead of submitting a second command', async () => {
  const delayed = delayedClassifier(); await setup();
  let rejectFirst; fetch.mockImplementationOnce(() => new Promise((_, reject) => { rejectFirst = reject; }));
  const first = client.v2Request({ method: 'POST', path: '/api/v2/clinical/prescriptions', body: { patient_id: patient, dose: 'Synthetic dose' } }).catch((error) => error);
  await vi.waitFor(() => expect(rejectFirst).toBeTypeOf('function'));
  const pending = write().catch((error) => error); await delayed.started;
  rejectFirst(new TypeError('Synthetic saved response lost')); await first; delayed.release();
  await expect(pending).resolves.toMatchObject({ data: { error: { code: 'write_review_required' } } }); expect(fetch).toHaveBeenCalledTimes(1); expect(ledger.getWriteUncertaintySnapshot().entries).toHaveLength(1);
});
it('does not count a recovery response when scope changes during deferred classifier loading', async () => {
  await setup(); fetch.mockRejectedValueOnce(new TypeError('Synthetic saved response lost')); await expect(write()).rejects.toBeDefined();
  const delayed = delayedClassifier();
  const evidence = ledger.captureWriteRecoveryRead(); let current = true;
  const pending = ledger.recordWriteRecoveryRead({ resolvedPath: `${resolved}/${course}`, pathParams }, { data: { patient_id: patient } }, { principal, readEvidence: evidence, isCurrentScope: () => current });
  await delayed.started; current = false; delayed.release(); await pending;
  expect(ledger.getWriteUncertaintySnapshot().entries[0].reviewed).toBe(false);
});
