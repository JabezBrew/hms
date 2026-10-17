import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { configureV2ApiClient, __resetV2ApiClientForTests, getV2ClientScopeKey } from '@/lib/api/v2/client';
import { bindNetworkAccessGuard } from '@/lib/api/v2/networkAccessGuard';
import { treatmentApi } from '../api';
import { actorId, facilityId, ids, scope, caseId, courseId, context, detail, dose, header, supply, command, receipt, json } from './fixtures';
const runtime = window.__HMS_RUNTIME_CONFIG__; const oldFetch = globalThis.fetch;
const base = () => `/api/v2/patients/${scope.patientId}/chronicle/admissions/${caseId}/medication-courses`;
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto); __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' };
  configureV2ApiClient({ getAccessToken: () => 'SYNTHETIC-TREATMENT-TOKEN', getFacilityCode: () => 'HMS', canRefreshSession: () => false });
  bindNetworkAccessGuard({ transportScope: getV2ClientScopeKey(), authorityScope: 'synthetic-treatment-authority', principal: { id: actorId, facility_id: facilityId, active_profile: 'hospital' } }).update({ confirmed: true, decision: { classification: 'onsite', access_allowed: true, read_only: false, policy_version: 1 } }); globalThis.fetch = vi.fn();
});
afterEach(() => { __resetV2ApiClientForTests(); vi.unstubAllGlobals(); globalThis.fetch = oldFetch; window.__HMS_RUNTIME_CONFIG__ = runtime; });
it('uses all exact generated rich read paths with explicit patient/case and preserved AbortSignal', async () => {
  const abort = new AbortController(); const calls = [['context', context(), `${base()}/context`], ['detail', detail(), `${base()}/${courseId}`]];
  for (const [method, value, path] of calls) { fetch.mockResolvedValueOnce(json({ data: value })); await treatmentApi[method](scope, { signal: abort.signal }); const [url, request] = fetch.mock.lastCall; expect(new URL(url).pathname).toBe(path); expect(request.signal).toBe(abort.signal); }
  const pages = [['list', header(), { limit: 25, cursor: 'synthetic-cursor', status: 'active', source_status: 'active', kind: 'scheduled' }, base()], ['doses', dose(), { limit: 25, status: 'scheduled', is_dispensed: false, scheduled_from: '2030-05-17T00:00:00Z', scheduled_before: '2030-05-18T00:00:00Z' }, `${base()}/${courseId}/doses`], ['supply', supply(), { limit: 25, status: 'partially_dispensed', kind: 'initial_generation' }, `${base()}/${courseId}/supply`]];
  for (const [method, row, query, path] of pages) { fetch.mockResolvedValueOnce(json({ data: [row], page: { has_next: true, next_cursor: 'synthetic-next', limit: 25 } })); const result = await treatmentApi[method](scope, query, { signal: abort.signal }); expect(result.rows).toEqual([row]); expect(result.next).toBe('synthetic-next'); const [input, request] = fetch.mock.lastCall; const url = new URL(input); expect(url.pathname).toBe(path); expect(Object.fromEntries(url.searchParams)).toEqual(Object.fromEntries(Object.entries(query).map(([key, value]) => [key, String(value)]))); expect(request.signal).toBe(abort.signal); }
});
it.each(['stop', 'window'])('sends exact reviewed %s wire fields and validates saved original membership', async (kind) => {
  const original = command(kind); fetch.mockResolvedValueOnce(json({ data: receipt(original) })); await expect(treatmentApi.write(original)).resolves.toEqual(receipt(original)); expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(original.payload); expect(new URL(fetch.mock.calls[0][0]).pathname).toBe(`${base()}/${courseId}/${kind === 'stop' ? 'stop' : 'supply-windows'}`);
  fetch.mockResolvedValueOnce(json({ data: { ...receipt(original), replayed: true } })); expect((await treatmentApi.recover(original)).replayed).toBe(true); expect(new URL(fetch.mock.calls[1][0]).pathname).toBe(`${base()}/${courseId}/requests/${original.payload.client_request_id}`);
});
it('preserves read AbortError and typed patient-denial errors without interpreting a failed page as empty', async () => {
  fetch.mockRejectedValueOnce(new DOMException('Synthetic abort', 'AbortError')); await expect(treatmentApi.context(scope)).rejects.toMatchObject({ name: 'AbortError' });
  fetch.mockResolvedValueOnce(json({ error: { code: 'patient_access_denied', message: 'Synthetic permission denied' } }, 403)); await expect(treatmentApi.detail(scope)).rejects.toMatchObject({ status: 403, data: { error: { code: 'patient_access_denied' } } });
  fetch.mockResolvedValueOnce(json({ error: { code: 'synthetic_unavailable', message: 'Synthetic unavailable' } }, 503)); await expect(treatmentApi.list(scope, { limit: 25 })).rejects.toMatchObject({ status: 503 });
});
it('rejects wrong-valid case, cursor loops, out-of-range rows and missing original command membership', async () => {
  fetch.mockResolvedValueOnce(json({ data: context({ admission_case_id: ids[20] }) })); await expect(treatmentApi.context(scope)).rejects.toThrow('could not be confirmed');
  fetch.mockResolvedValueOnce(json({ data: [], page: { has_next: true, next_cursor: 'same' } })); await expect(treatmentApi.list(scope, { cursor: 'same' })).rejects.toThrow();
  fetch.mockResolvedValueOnce(json({ data: [dose({ scheduled_at: '2030-05-18T00:00:00Z' })], page: { has_next: false, next_cursor: null } })); await expect(treatmentApi.doses(scope, { scheduled_before: '2030-05-18T00:00:00Z' })).rejects.toThrow();
  fetch.mockResolvedValueOnce(json({ data: [dose()], page: { has_next: false, next_cursor: null } })); await expect(treatmentApi.doses(scope, { request_id: ids[12] })).rejects.toThrow();
});
it.each(['actor', 'ward', 'input', 'count', 'unit'])('does not confirm malformed %s mutation success', async (fault) => {
  const original = command(['count', 'unit'].includes(fault) ? 'window' : 'stop'); const value = receipt(original);
  if (fault === 'actor') value.recorded_by_user_id = ids[20]; if (fault === 'ward') value.result.ward_name = 'Different synthetic ward'; if (fault === 'input') value.reviewed_input.reason = 'Different reason'; if (fault === 'count') value.result.created_dose_count += 1; if (fault === 'unit') value.result.created_doses[0].scheduled_stock_policy.stock_unit = 'pack';
  fetch.mockResolvedValueOnce(json({ data: value })); await expect(treatmentApi.write(original)).rejects.toMatchObject({ name: 'TreatmentWriteUnconfirmedError' });
});
it('keeps exact definite conflicts distinct from generic commit uncertainty and does not retry either automatically', async () => {
  fetch.mockResolvedValueOnce(json({ error: { code: 'treatment_course_snapshot_changed', message: 'Synthetic source changed' } }, 409)); await expect(treatmentApi.write(command())).rejects.toMatchObject({ status: 409, data: { error: { code: 'treatment_course_snapshot_changed' } } }); expect(fetch).toHaveBeenCalledTimes(1);
  fetch.mockResolvedValueOnce(json({ error: { code: 'treatment_course_write_unconfirmed', message: 'Synthetic storage uncertainty' } }, 409)); await expect(treatmentApi.write(command())).rejects.toMatchObject({ name: 'TreatmentWriteUnconfirmedError' }); expect(fetch).toHaveBeenCalledTimes(2);
});
