import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { configureV2ApiClient, __resetV2ApiClientForTests, getV2ClientScopeKey } from '@/lib/api/v2/client';
import { bindNetworkAccessGuard } from '@/lib/api/v2/networkAccessGuard';
import { advisoryApi } from '../api';
import { actorId, facilityId, patientId, caseId, advisoryId, ids, caseRow, context, detail, command, receipt, json } from './fixtures';
const runtime = window.__HMS_RUNTIME_CONFIG__; const oldFetch = globalThis.fetch;
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' }; configureV2ApiClient({ getAccessToken: () => 'SYNTHETIC-TOKEN', getFacilityCode: () => 'HMS', canRefreshSession: () => false }); bindNetworkAccessGuard({ transportScope: getV2ClientScopeKey(), authorityScope: 'synthetic-advisory-authority', principal: { id: actorId, facility_id: facilityId, active_profile: 'hospital' } }).update({ confirmed: true, decision: { classification: 'onsite', access_allowed: true, read_only: false, policy_version: 1 } }); globalThis.fetch = vi.fn(); });
afterEach(() => { __resetV2ApiClientForTests(); vi.unstubAllGlobals(); globalThis.fetch = oldFetch; window.__HMS_RUNTIME_CONFIG__ = runtime; });
it('uses exact scoped reads with bounded query, opaque cursor and AbortSignal', async () => {
  const abort = new AbortController(); fetch.mockResolvedValueOnce(json({ data: [caseRow()], page: { has_next: true, next_cursor: 'synthetic-next' } })); const page = await advisoryApi.cases(patientId, { limit: 25, cursor: 'synthetic-current', include_closed: true }, { signal: abort.signal }); expect(page.cursor).toBe('synthetic-next'); const url = new URL(fetch.mock.calls[0][0]); expect(url.pathname).toBe(`/api/v2/patients/${patientId}/chronicle/admission-advisory-cases`); expect(Object.fromEntries(url.searchParams)).toEqual({ cursor: 'synthetic-current', include_closed: 'true', limit: '25' }); expect(fetch.mock.calls[0][1].signal).toBe(abort.signal);
  fetch.mockResolvedValueOnce(json({ data: context() })); await advisoryApi.context({ patientId, caseId }, { signal: abort.signal }); expect(new URL(fetch.mock.calls[1][0]).pathname).toBe(`/api/v2/patients/${patientId}/chronicle/admissions/${caseId}/advisories`);
  fetch.mockResolvedValueOnce(json({ data: detail() })); await advisoryApi.detail({ patientId, caseId }, advisoryId, { signal: abort.signal }); expect(new URL(fetch.mock.calls[2][0]).pathname.endsWith(`/advisories/${advisoryId}`)).toBe(true);
});
it.each(['create', 'decision'])('sends the exact reviewed %s body and validates its immutable result', async (kind) => {
  const input = command(kind); fetch.mockResolvedValueOnce(json({ data: receipt(input) })); await advisoryApi.write(input); expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(input.payload); expect(new URL(fetch.mock.calls[0][0]).pathname.endsWith(kind === 'create' ? '/advisories' : `/advisories/${advisoryId}/decision`)).toBe(true);
  fetch.mockResolvedValueOnce(json({ data: { ...receipt(input), replayed: true } })); await advisoryApi.recover(input); expect(new URL(fetch.mock.calls[1][0]).pathname.endsWith(`/advisories/requests/${input.payload.client_request_id}`)).toBe(true);
});
it('preserves AbortError and refuses repeating cursor/wrong-valid context', async () => {
  fetch.mockRejectedValueOnce(new DOMException('Synthetic abort', 'AbortError')); await expect(advisoryApi.cases(patientId, { limit: 25 })).rejects.toMatchObject({ name: 'AbortError' });
  fetch.mockResolvedValueOnce(json({ data: [caseRow()], page: { has_next: true, next_cursor: 'same' } })); await expect(advisoryApi.cases(patientId, { cursor: 'same' })).rejects.toThrow('could not be confirmed'); fetch.mockResolvedValueOnce(json({ data: context({ admission_case_id: ids[20] }) })); await expect(advisoryApi.context({ patientId, caseId })).rejects.toThrow('could not be confirmed');
});
it.each(['wrong-actor', 'wrong-note', 'wrong-id'])('treats %s malformed success as unconfirmed rather than a confirmed write', async (fault) => {
  const input = command(); const value = receipt(input); if (fault === 'wrong-actor') value.advisory.created_by_user_id = ids[20]; else if (fault === 'wrong-note') value.advisory.notes = 'Different synthetic note'; else value.client_request_id = ids[20]; fetch.mockResolvedValueOnce(json({ data: value })); await expect(advisoryApi.write(input)).rejects.toMatchObject({ name: 'AdvisoryUnconfirmedError' });
});
