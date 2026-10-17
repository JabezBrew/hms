import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { __resetV2ApiClientForTests, configureV2ApiClient, getV2ClientScopeKey, v2Request } from '../client';
import { bindNetworkAccessGuard } from '../networkAccessGuard';
import { activateWriteUncertainty, getWriteUncertaintySnapshot, resetWriteUncertaintyForTests, WRITE_UNCERTAINTY_KEY } from '../writeUncertainty';
const ids = Array.from({ length: 9 }, (_, i) => `71000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [actor, facility, patient, admission, course, requestId, otherAdmission, otherCourse] = ids;
const principal = { id: actor, facility_id: facility, active_profile: 'hospital' };
const root = '/api/v2/patients/{patient_id}/chronicle/admissions/{admission_case_id}/medication-courses';
const params = { patient_id: patient, admission_case_id: admission, course_id: course };
const originalRuntime = window.__HMS_RUNTIME_CONFIG__; const originalFetch = globalThis.fetch;
const json = (data) => new Response(JSON.stringify({ data }), { headers: { 'content-type': 'application/json' } });
const payload = { client_request_id: requestId, expected_source_token: 'a'.repeat(64), expected_course_token: 'b'.repeat(64), expected_context_token: 'c'.repeat(64), reason: 'Synthetic private course decision' };
function activate(token = 'synthetic-private-course-token') {
  configureV2ApiClient({ getAccessToken: () => token, getFacilityCode: () => 'QA', canRefreshSession: () => false });
  bindNetworkAccessGuard({ transportScope: getV2ClientScopeKey(), authorityScope: 'synthetic-course-authority', principal }).update({ confirmed: true, decision: { access_allowed: true, read_only: false, classification: 'onsite', policy_version: 1 } });
  activateWriteUncertainty(principal);
}
function write(action = 'stop', body = payload, pathParams = params) { return v2Request({ method: 'POST', path: `${root}/{course_id}/${action}`, pathParams, body }); }
function read(suffix, pathParams = params, data = { summary: { id: course, patient_id: patient, admission_case_id: admission } }) { fetch.mockResolvedValueOnce(json(data)); return v2Request({ method: 'GET', path: `${root}${suffix}`, pathParams }); }
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' }; activate(); globalThis.fetch = vi.fn(); });
afterEach(() => { __resetV2ApiClientForTests(); vi.unstubAllGlobals(); globalThis.fetch = originalFetch; window.__HMS_RUNTIME_CONFIG__ = originalRuntime; });
it.each(['stop', 'supply-windows'])('permits only an explicit exact %s retry after response loss and token rotation', async (action) => {
  const body = action === 'stop' ? payload : { ...payload, reason: undefined, expected_scheduled_through: '2026-10-19T00:00:00Z', scheduled_before: '2026-10-20T00:00:00Z', note: 'Synthetic private supply note' };
  fetch.mockRejectedValueOnce(new TypeError('Synthetic response lost')); await expect(write(action, body)).rejects.toMatchObject({ status: 0 }); const first = fetch.mock.calls[0];
  const stored = sessionStorage.getItem(WRITE_UNCERTAINTY_KEY); for (const value of [actor, facility, patient, admission, course, payload.reason, body.note, payload.expected_source_token, 'synthetic-private-course-token', '/medication-courses'].filter(Boolean)) expect(stored).not.toContain(value);
  resetWriteUncertaintyForTests({ preserveStorage: true }); activate('synthetic-rotated-course-token');
  for (const [changedBody, changedParams] of [[{ ...body, client_request_id: ids[8] }, params], [{ ...body, expected_source_token: 'd'.repeat(64) }, params], [body, { ...params, admission_case_id: otherAdmission }], [body, { ...params, course_id: otherCourse }]]) { await expect(write(action, changedBody, changedParams)).rejects.toMatchObject({ data: { error: { code: 'write_review_required' } } }); expect(fetch).toHaveBeenCalledTimes(1); }
  fetch.mockResolvedValueOnce(json({ client_request_id: requestId })); await write(action, body); expect(fetch.mock.calls[1][0]).toBe(first[0]); expect(fetch.mock.calls[1][1].body).toBe(first[1].body); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
it('excludes lean list and eligibility context from manual saved-record review', async () => {
  fetch.mockRejectedValueOnce(new TypeError('Synthetic response lost')); await expect(write()).rejects.toBeDefined();
  await read('', params, [{ id: course, admission_case_id: admission }]); expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(false);
  await read('/context', params, { patient_id: patient, admission_case_id: admission, can_manage_courses: true }); expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(false);
});
it('binds a fresh rich review to both the original course and admission without confirming the write', async () => {
  fetch.mockRejectedValueOnce(new TypeError('Synthetic response lost')); await expect(write()).rejects.toBeDefined();
  await read('/{course_id}', { ...params, course_id: otherCourse }); expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(false);
  await read('/{course_id}', { ...params, admission_case_id: otherAdmission }); expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(false);
  await read('/{course_id}'); expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(true); expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
  await expect(write('stop', { ...payload, client_request_id: ids[8] })).rejects.toMatchObject({ data: { error: { code: 'write_review_required' } } });
});
it('does not give an unsupported suffix exact-retry eligibility', async () => {
  fetch.mockRejectedValueOnce(new TypeError('Synthetic response lost')); await expect(write('stop/extra')).rejects.toBeDefined(); await expect(write('stop/extra')).rejects.toMatchObject({ data: { error: { code: 'write_review_required' } } }); expect(fetch).toHaveBeenCalledTimes(1);
});
it('does not treat a medication-course read as saved clinical-note evidence for the same patient', async () => {
  fetch.mockRejectedValueOnce(new TypeError('Synthetic note response lost'));
  await expect(v2Request({ method: 'POST', path: '/api/v2/patients/{patient_id}/clinical/notes/record', pathParams: { patient_id: patient }, body: { client_request_id: requestId, narrative: 'Synthetic private clinical note' } })).rejects.toBeDefined();
  await read('/{course_id}'); expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(false);
});
it('ignores a rich recovery read dispatched before the transport credentials changed', async () => {
  fetch.mockRejectedValueOnce(new TypeError('Synthetic response lost')); await expect(write()).rejects.toBeDefined();
  let resolve; const pending = new Promise((done) => { resolve = done; }); fetch.mockReturnValueOnce(pending);
  const loaded = v2Request({ method: 'GET', path: `${root}/{course_id}`, pathParams: params });
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  activate('synthetic-new-session-token');
  resolve(json({ summary: { id: course, patient_id: patient, admission_case_id: admission } })); await loaded;
  await vi.waitFor(() => expect(getWriteUncertaintySnapshot().entries).toHaveLength(1));
  expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(false);
});
