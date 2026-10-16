import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';
import { handoverApi } from '../api';
import { handoverKeys } from '../keys';
import { handoverPayload, emptyHandover } from '../model';
import { ids, rootId, patientId, admissionId, requestId, payload, command, receipt, detail, header, current, json, page } from './fixtures';
const originalFetch = globalThis.fetch; const originalRuntime = window.__HMS_RUNTIME_CONFIG__;
beforeEach(() => { window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' }; __resetV2ApiClientForTests(); configureV2ApiClient({ getAccessToken: () => 'synthetic-token', getFacilityCode: () => 'HMS', canRefreshSession: () => false }); globalThis.fetch = vi.fn(); });
afterEach(() => { globalThis.fetch = originalFetch; window.__HMS_RUNTIME_CONFIG__ = originalRuntime; __resetV2ApiClientForTests(); });
it('uses actual generated flat create and amendment/void bodies with unchanged AbortSignal', async () => {
  const signal = new AbortController().signal;
  globalThis.fetch.mockResolvedValueOnce(json({ data: receipt() })); await expect(handoverApi.write(command, { signal })).resolves.toMatchObject({ handover: { revision: 1 } });
  const amend = { ...command, kind: 'amend', source: detail, payload: { ...payload, expected_revision: 1, reason: 'Synthetic correction' } }; delete amend.payload.patient_id; delete amend.payload.admission_case_id;
  globalThis.fetch.mockResolvedValueOnce(json({ data: receipt(amend) })); await handoverApi.write(amend, { signal });
  const voidCommand = { ...command, kind: 'void', source: detail, payload: { client_request_id: requestId, expected_revision: 1, reason: 'Synthetic void' } };
  globalThis.fetch.mockResolvedValueOnce(json({ data: receipt(voidCommand) })); await handoverApi.write(voidCommand, { signal });
  for (const [i, cmd] of [command, amend, voidCommand].entries()) { const [url, options] = globalThis.fetch.mock.calls[i]; expect(JSON.parse(options.body)).toEqual(cmd.payload); expect(options.signal).toBe(signal); expect(options.method).toBe('POST'); expect(new URL(url).pathname).toBe(`/api/v2/nursing/patient-handovers${i ? `/${rootId}/${cmd.kind}` : ''}`); }
});
it('sends patient/admission and real cursor scopes before bounded lists, history, recipients and recovery', async () => {
  const signal = new AbortController().signal; const query = { patient_id: patientId, admission_case_id: admissionId, include_voided: true, cursor: 'server-cursor', limit: 1 };
  globalThis.fetch.mockResolvedValueOnce(page([header], 'next-cursor')); await expect(handoverApi.list(query, { signal })).resolves.toMatchObject({ hasNext: true, cursor: 'next-cursor' });
  globalThis.fetch.mockResolvedValueOnce(page([{ ...current, narrative: undefined, reason: undefined }])); await handoverApi.history(rootId, { cursor: 'history-cursor', limit: 1 }, { signal });
  globalThis.fetch.mockResolvedValueOnce(page([])); await handoverApi.recipients({ patient_id: patientId, admission_case_id: admissionId, handover_id: rootId, limit: 25 }, { signal });
  globalThis.fetch.mockResolvedValueOnce(json({ data: { ...receipt(), replayed: true } })); await handoverApi.recover(command, { signal });
  const calls = globalThis.fetch.mock.calls.map(([url, options]) => ({ url: new URL(url), options })); expect(calls[0].url.searchParams.get('admission_case_id')).toBe(admissionId); expect(calls[0].url.searchParams.get('cursor')).toBe('server-cursor'); expect(calls[1].url.searchParams.get('cursor')).toBe('history-cursor'); expect(calls[2].url.searchParams.get('handover_id')).toBe(rootId); expect(calls[3].url.pathname).toContain(`/requests/${requestId}`); expect(calls[3].url.searchParams.get('patient_id')).toBe(patientId); for (const call of calls) expect(call.options.signal).toBe(signal);
});
it.each(['patient', 'admission', 'author', 'recorded-actor', 'UUID', 'condition', 'revision', 'shift', 'reason'])('keeps malformed %s write receipts uncertain without retry', async (fault) => {
  const saved = structuredClone(receipt()); const root = saved.handover;
  if (fault === 'patient') root.patient_id = ids[9]; if (fault === 'admission') root.admission_case_id = ids[9]; if (fault === 'author') root.author_user_id = ids[9]; if (fault === 'recorded-actor') root.current.recorded_by_user_id = ids[9]; if (fault === 'UUID') saved.client_request_id = ids[9]; if (fault === 'condition') root.current.narrative.patient_condition = 'Different synthetic text'; if (fault === 'revision') root.revision = root.current.revision = 2; if (fault === 'shift') root.shift_type = root.current.shift_type = 'day'; if (fault === 'reason') root.current.reason = 'Invented reason';
  globalThis.fetch.mockResolvedValueOnce(json({ data: saved })); await expect(handoverApi.write(command)).rejects.toMatchObject({ name: 'HandoverUnconfirmedError' }); expect(globalThis.fetch).toHaveBeenCalledTimes(1);
});
it('distinguishes definite conflicts, generic commit uncertainty and missing original results', async () => {
  globalThis.fetch.mockResolvedValueOnce(json({ error: { code: 'patient_handover_changed', message: 'Refresh source' } }, 409)); await expect(handoverApi.write(command)).rejects.toMatchObject({ status: 409 });
  globalThis.fetch.mockResolvedValueOnce(json({ error: { code: 'patient_handover_write_unconfirmed' } }, 409)); await expect(handoverApi.write(command)).rejects.toMatchObject({ name: 'HandoverUnconfirmedError' });
  globalThis.fetch.mockResolvedValueOnce(json({ error: { code: 'not_found' } }, 404)); await expect(handoverApi.recover(command)).rejects.toMatchObject({ status: 404 }); expect(globalThis.fetch).toHaveBeenCalledTimes(3);
});
it('fails repeated cursors, foreign scopes and later-page errors instead of hiding partial reads', async () => {
  globalThis.fetch.mockResolvedValueOnce(page([header], 'same')); await expect(handoverApi.list({ patient_id: patientId, cursor: 'same', limit: 1 })).rejects.toThrow('page');
  globalThis.fetch.mockResolvedValueOnce(page([{ ...header, patient_id: ids[9] }])); await expect(handoverApi.list({ patient_id: patientId })).rejects.toThrow('scope');
  const abort = new DOMException('Synthetic abort', 'AbortError'); globalThis.fetch.mockRejectedValueOnce(abort); await expect(handoverApi.list({ patient_id: patientId })).rejects.toBe(abort);
  globalThis.fetch.mockResolvedValueOnce(json({ error: { code: 'unavailable' } }, 503)); await expect(handoverApi.history(rootId, { cursor: 'later' })).rejects.toMatchObject({ status: 503 });
});
it('keeps all copied clinical query inputs opaque while distinguishing scope, page and authority', () => {
  const key = handoverKeys.list('opaque-auth', 'SYNTHETIC-PATIENT-NAME', { patient_id: patientId, cursor: 'SYNTHETIC-MRN-LIKE-TEXT' }); expect(JSON.stringify(key)).not.toContain('SYNTHETIC'); expect(JSON.stringify(key)).not.toContain(patientId);
  expect(key).not.toEqual(handoverKeys.list('opaque-auth', 'SYNTHETIC-PATIENT-NAME', { patient_id: patientId })); expect(key).not.toEqual(handoverKeys.list('different-auth', 'SYNTHETIC-PATIENT-NAME', { patient_id: patientId, cursor: 'SYNTHETIC-MRN-LIKE-TEXT' }));
});
it('requires an explicit shift and condition and retains all seven bounded narrative fields', () => {
  const form = emptyHandover(); expect(() => handoverPayload('record', form, { patientId, admissionId, requestId })).toThrow('shift'); form.shift_type = 'night'; expect(() => handoverPayload('record', form, { patientId, admissionId, requestId })).toThrow('Current condition'); form.narrative.patient_condition = ' Synthetic condition '; const p = handoverPayload('record', form, { patientId, admissionId, requestId }); expect(Object.keys(p.narrative)).toHaveLength(7); expect(p.narrative.patient_condition).toBe('Synthetic condition'); expect(p).not.toHaveProperty('author_user_id');
});
it('requires the exact requested historical revision rather than another version from the same root', async () => {
  globalThis.fetch.mockResolvedValueOnce(json({ data: current })); await expect(handoverApi.revision(rootId, ids[9])).rejects.toThrow('selected historical revision');
  const signal = new AbortController().signal; globalThis.fetch.mockResolvedValueOnce(json({ data: current })); await expect(handoverApi.revision(rootId, current.id, { signal })).resolves.toEqual(current); expect(globalThis.fetch.mock.calls[1][1].signal).toBe(signal);
});
