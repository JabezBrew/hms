import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';
import { courseApi } from '../courseApi';
import { coursePayload, courseReceipt, documentationReceipt, patientId, requestId, source } from './fixtures';

const fetchOriginal = globalThis.fetch; const runtime = window.__HMS_RUNTIME_CONFIG__;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
beforeEach(() => { __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' }; configureV2ApiClient({ getAccessToken: () => 'synthetic-token', getFacilityCode: () => 'HMS', canRefreshSession: () => false }); globalThis.fetch = vi.fn(); });
afterEach(() => { __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = runtime; globalThis.fetch = fetchOriginal; });
it('reads only an authoritative matching patient prescription and preserves its AbortSignal', async () => {
  const signal = new AbortController().signal; globalThis.fetch.mockResolvedValueOnce(json({ data: source })); await expect(courseApi.detail(source.id, patientId, { signal })).resolves.toMatchObject({ instructions: source.instructions, reason: source.reason }); expect(globalThis.fetch.mock.calls[0][0]).toBe(`http://localhost:8080/api/v2/clinical/prescriptions/${source.id}`); expect(globalThis.fetch.mock.calls[0][1].signal).toBe(signal);
  globalThis.fetch.mockResolvedValueOnce(json({ data: source })); await expect(courseApi.detail(source.id, requestId)).rejects.toThrow(/could not be confirmed/);
});
it('sends the dedicated documentation contract and confirms saved text separately from regimen', async () => {
  const payload = { client_request_id: requestId, expected_snapshot_token: source.snapshot_token, instructions: '', reason: 'Synthetic corrected reason' }; globalThis.fetch.mockResolvedValueOnce(json({ data: documentationReceipt(payload) })); const result = await courseApi.documentation(source, payload); expect(result.prescription.instructions).toBe(''); const [url, request] = globalThis.fetch.mock.calls[0]; expect(url).toContain(`/${source.id}/documentation`); expect(request.method).toBe('PATCH'); expect(JSON.parse(request.body)).toEqual(payload);
});
it('sends a full explicit new course without copied admission, automatic schedule or stock defaults', async () => {
  globalThis.fetch.mockResolvedValueOnce(json({ data: courseReceipt() })); await courseApi.course(source, coursePayload); const [url, request] = globalThis.fetch.mock.calls[0]; expect(url).toContain(`/${source.id}/new-course`); expect(request.method).toBe('POST'); expect(JSON.parse(request.body)).toEqual(coursePayload); expect(request.body).not.toContain('generate_mar'); expect(request.body).not.toContain('admission_case_id');
});
it.each(['patient', 'source', 'route', 'date', 'provenance', 'implicit-first-dose', 'source-status'])('does not confirm malformed %s course receipts', async (fault) => {
  const receipt = courseReceipt(); if (fault === 'patient') receipt.prescription.patient_id = requestId; if (fault === 'source') receipt.source_prescription_id = requestId; if (fault === 'route') receipt.prescription.route = 'iv'; if (fault === 'date') receipt.prescription.start_date = '2026-10-18'; if (fault === 'provenance') receipt.prescription.provenance.change_reason = 'Different reason'; if (fault === 'implicit-first-dose') receipt.prescription.first_dose_at = '2026-10-17T01:00:00Z'; if (fault === 'source-status') receipt.source_status_after = 'active'; globalThis.fetch.mockResolvedValueOnce(json({ data: receipt })); await expect(courseApi.course(source, coursePayload)).rejects.toMatchObject({ name: 'PrescriptionActionUnconfirmedError' }); expect(globalThis.fetch).toHaveBeenCalledTimes(1);
});
it('preserves typed definite conflicts and classifies commit uncertainty without automatic retries', async () => {
  globalThis.fetch.mockResolvedValueOnce(json({ error: { code: 'prescription_source_changed', message: 'Refresh source' } }, 409)); await expect(courseApi.course(source, coursePayload)).rejects.toMatchObject({ status: 409 }); globalThis.fetch.mockResolvedValueOnce(json({ error: { code: 'prescription_action_unconfirmed' } }, 409)); await expect(courseApi.course(source, coursePayload)).rejects.toMatchObject({ name: 'PrescriptionActionUnconfirmedError' }); expect(globalThis.fetch).toHaveBeenCalledTimes(2);
});
it('reads an original immutable request result without generating a different key or another POST', async () => {
  globalThis.fetch.mockResolvedValueOnce(json({ data: { ...courseReceipt(), replayed: true } })); await expect(courseApi.recover('course', source, coursePayload)).resolves.toMatchObject({ replayed: true }); expect(globalThis.fetch.mock.calls[0][0]).toContain(`/new-course/requests/${requestId}`); expect(globalThis.fetch.mock.calls[0][1].method).toBe('GET');
  globalThis.fetch.mockResolvedValueOnce(json({ error: { code: 'not_found' } }, 404)); await expect(courseApi.recover('course', source, coursePayload)).rejects.toMatchObject({ status: 404 }); expect(globalThis.fetch).toHaveBeenCalledTimes(2);
});

it('confirms explicitly reviewed PRN limits while rejecting a changed saved stock basis', async () => {
  const original = { ...source, frequency: 'prn', prn_policy: { minimum_interval_hours: 6, maximum_doses_per_24_hours: 2, stock_units_per_dose: 1, indication: 'Synthetic old indication', stock_unit: 'tablet' } };
  const payload = { ...coursePayload, frequency: 'prn', inventory_item_id: requestId, expected_stock_unit: 'tablet', prn_policy: { minimum_interval_hours: 4, maximum_doses_per_24_hours: 3, stock_units_per_dose: 2, indication: 'Synthetic reviewed indication', expected_stock_unit: 'tablet' } };
  globalThis.fetch.mockResolvedValueOnce(json({ data: courseReceipt(payload, original) })); await expect(courseApi.course(original, payload)).resolves.toMatchObject({ prescription: { prn_policy: { minimum_interval_hours: 4, maximum_doses_per_24_hours: 3 } } });
  const malformed = courseReceipt(payload, original); malformed.prescription.stock_unit = 'pack'; globalThis.fetch.mockResolvedValueOnce(json({ data: malformed })); await expect(courseApi.course(original, payload)).rejects.toMatchObject({ name: 'PrescriptionActionUnconfirmedError' });
});
