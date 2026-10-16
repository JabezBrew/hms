import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';
import { fluidApi } from '../api';
import { formFromObservation, valuesPayload } from '../model';
const ids = Array.from({ length: 6 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [id, patient, admission, key] = ids;
const row = { id, root_entry_id: id, patient_id: patient, admission_case_id: admission, revision: 1, current: true, created_at: '2026-01-01T08:00:00Z', values: { recorded_at: '2026-01-01T08:00:59.123Z', intake_ml: 300, output_ml: 100, metadata: { intake_category: 'oral', output_category: 'urine' } } };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const page = (rows, cursor = null) => json({ data: rows, page: { has_next: Boolean(cursor), next_cursor: cursor, limit: 100 } });
const saved = { client_request_id: key, root_entry_id: id, entry_id: id, revision: 1, action: 'created', replayed: false };
const originalFetch = globalThis.fetch; const originalRuntime = window.__HMS_RUNTIME_CONFIG__;
beforeEach(() => { window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' }; __resetV2ApiClientForTests(); configureV2ApiClient({ getAccessToken: () => 'synthetic-token', getFacilityCode: () => 'HMS', canRefreshSession: () => false }); globalThis.fetch = vi.fn(); });
afterEach(() => { globalThis.fetch = originalFetch; window.__HMS_RUNTIME_CONFIG__ = originalRuntime; __resetV2ApiClientForTests(); });
describe('fluid immutable generated contracts', () => {
  it('posts flat UUID-bound create/correct/void payloads and checks receipt identity', async () => {
    const signal = new AbortController().signal; const payload = { client_request_id: key, admission_case_id: admission, values: row.values };
    globalThis.fetch.mockResolvedValueOnce(json({ data: saved })); await fluidApi.create(payload, { signal }); expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toEqual(payload); expect(globalThis.fetch.mock.calls[0][1].signal).toBe(signal);
    const corrected = { ...saved, revision: 2, action: 'corrected', entry_id: ids[4] }; const change = { client_request_id: key, reason: 'Synthetic correction', replacement: row.values };
    globalThis.fetch.mockResolvedValueOnce(json({ data: corrected })); await fluidApi.correct(id, change, id, { signal }); expect(new URL(globalThis.fetch.mock.calls[1][0]).pathname).toBe(`/api/v2/nursing/fluid-observations/${id}/corrections`); expect(JSON.parse(globalThis.fetch.mock.calls[1][1].body)).toEqual(change);
    globalThis.fetch.mockResolvedValueOnce(json({ data: { ...saved, action: 'voided', revision: 3 } })); await fluidApi.void(id, { client_request_id: key, reason: 'Synthetic void' }, id, { signal }); expect(new URL(globalThis.fetch.mock.calls[2][0]).pathname).toBe(`/api/v2/nursing/fluid-observations/${id}/void`);
  });
  it.each([{}, { ...saved, client_request_id: ids[5] }, { ...saved, revision: 0 }, { ...saved, action: 'voided' }])('treats malformed success as an uncertain write', async (data) => { globalThis.fetch.mockResolvedValueOnce(json({ data })); await expect(fluidApi.create({ client_request_id: key })).rejects.toMatchObject({ name: 'FluidWriteUnconfirmedError' }); expect(globalThis.fetch).toHaveBeenCalledTimes(1); });
  it('keeps generic409 uncertain and typed409 definite, without automatic retry', async () => {
    globalThis.fetch.mockResolvedValueOnce(json({ error: { code: 'fluid_write_unconfirmed', message: 'Refresh history' } }, 409)); await expect(fluidApi.create({ client_request_id: key })).rejects.toMatchObject({ name: 'FluidWriteUnconfirmedError' });
    globalThis.fetch.mockResolvedValueOnce(json({ error: { code: 'fluid_observation_conflict', message: 'Already corrected' } }, 409)); await expect(fluidApi.void(id, { client_request_id: key }, id)).rejects.toMatchObject({ status: 409 }); expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
  it('uses patient/admission/time scopes before following all cursors with the original AbortSignal', async () => {
    const signal = new AbortController().signal; const query = { patient_id: patient, admission_case_id: admission, recorded_from: '2026-01-01T00:00:00Z', recorded_before: '2026-01-02T00:00:00Z' };
    globalThis.fetch.mockResolvedValueOnce(page(Array.from({ length: 100 }, (_, index) => ({ ...row, id: `00000000-0000-4000-8000-${String(index + 100).padStart(12, '0')}` })), 'opaque-next')).mockResolvedValueOnce(page([row])); const result = await fluidApi.all(query, { signal }); expect(result).toHaveLength(101);
    for (const [url, options] of globalThis.fetch.mock.calls) { const params = new URL(url).searchParams; expect(params.get('patient_id')).toBe(patient); expect(params.get('admission_case_id')).toBe(admission); expect(params.get('recorded_before')).toBe(query.recorded_before); expect(options.signal).toBe(signal); } expect(new URL(globalThis.fetch.mock.calls[1][0]).searchParams.get('cursor')).toBe('opaque-next');
  });
  it('rejects later page failures and repeated cursors rather than returning partial observations', async () => {
    globalThis.fetch.mockResolvedValueOnce(page([row], 'loop')).mockResolvedValueOnce(page([row], 'loop')); await expect(fluidApi.all({ patient_id: patient })).rejects.toThrow(/could not be completed/);
    globalThis.fetch.mockReset().mockResolvedValueOnce(page([row], 'next')).mockResolvedValueOnce(json({ error: { code: 'unavailable' } }, 503)); await expect(fluidApi.all({ patient_id: patient })).rejects.toMatchObject({ status: 503 });
  });
  it('rejects mismatched patient data and preserves AbortError for reads', async () => {
    globalThis.fetch.mockResolvedValueOnce(page([{ ...row, patient_id: ids[5] }])); await expect(fluidApi.list({ patient_id: patient })).rejects.toThrow(/scope/);
    globalThis.fetch.mockRejectedValueOnce(new DOMException('Aborted', 'AbortError')); await expect(fluidApi.get(id)).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('loads complete category aggregates without treating a bounded entry page as totals', async () => {
    const aggregate = { entry_count: 1000, total_intake_ml: 300000, total_output_ml: 100000, net_ml: 200000, intake_breakdown: [{ category: 'oral', total_ml: 300000 }], output_breakdown: [{ category: 'urine', total_ml: 100000 }] }; globalThis.fetch.mockResolvedValueOnce(json({ data: aggregate })); await expect(fluidApi.summary({ patient_id: patient })).resolves.toEqual(aggregate); expect(new URL(globalThis.fetch.mock.calls[0][0]).pathname).toMatch(/fluid-observations\/summary$/);
  });
  it('preserves unedited paired measurements and original sub-minute observation time on correction', () => {
    const form = formFromObservation(row); form.metadata.notes = 'A corrected note'; const payload = valuesPayload(form, row); expect(payload.intake_ml).toBe(300); expect(payload.output_ml).toBe(100); expect(payload.recorded_at).toBe(row.values.recorded_at);
    expect(() => valuesPayload({ ...form, intake_ml: '1.5' }, row)).toThrow(/whole/);
  });
});
