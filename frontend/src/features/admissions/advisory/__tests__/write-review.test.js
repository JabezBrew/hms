import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { v2Request, configureV2ApiClient, __resetV2ApiClientForTests, getV2ClientScopeKey } from '@/lib/api/v2/client';
import { bindNetworkAccessGuard } from '@/lib/api/v2/networkAccessGuard';
import { acknowledgeWriteResponse, activateWriteUncertainty, getWriteUncertaintySnapshot, resetWriteUncertaintyForTests, WRITE_UNCERTAINTY_KEY } from '@/lib/api/v2/writeUncertainty';
import { advisoryApi } from '../api';
import { actorId, facilityId, patientId, caseId, otherCaseId, advisoryId, ids, caseRow, context, detail, command, receipt, json } from './fixtures';
const runtime = window.__HMS_RUNTIME_CONFIG__; const oldFetch = globalThis.fetch;
const principal = { id: actorId, facility_id: facilityId, active_profile: 'hospital' };
function activate(token = 'SYNTHETIC-PRIVATE-ADVISORY-TOKEN') { configureV2ApiClient({ getAccessToken: () => token, getFacilityCode: () => 'HMS', canRefreshSession: () => false }); bindNetworkAccessGuard({ transportScope: getV2ClientScopeKey(), authorityScope: 'synthetic-advisory-authority', principal }).update({ confirmed: true, decision: { classification: 'onsite', access_allowed: true, read_only: false, policy_version: 1 } }); activateWriteUncertainty(principal); }
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' }; activate(); globalThis.fetch = vi.fn(); });
afterEach(() => { __resetV2ApiClientForTests(); vi.unstubAllGlobals(); globalThis.fetch = oldFetch; window.__HMS_RUNTIME_CONFIG__ = runtime; });
it.each(['create', 'decision'])('retains opaque %s uncertainty across reload/credential rotation and allows only exact UUID/body/case retry', async (kind) => {
  const original = command(kind); fetch.mockRejectedValueOnce(new TypeError('Synthetic response lost')); await expect(advisoryApi.write(original)).rejects.toMatchObject({ name: 'AdvisoryUnconfirmedError' }); const first = fetch.mock.calls[0]; expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
  const stored = sessionStorage.getItem(WRITE_UNCERTAINTY_KEY); for (const value of [actorId, patientId, caseId, advisoryId, original.payload.notes, original.payload.reason, original.payload.expected_context_token, 'SYNTHETIC-PRIVATE-ADVISORY-TOKEN'].filter(Boolean)) expect(stored).not.toContain(value);
  resetWriteUncertaintyForTests({ preserveStorage: true }); activate('SYNTHETIC-ROTATED-ADVISORY-TOKEN');
  for (const changed of [{ ...original, payload: { ...original.payload, client_request_id: ids[20] } }, { ...original, payload: { ...original.payload, ...(kind === 'create' ? { notes: 'Different synthetic intent' } : { reason: 'Different synthetic reason' }) } }, { ...original, caseId: otherCaseId }]) { await expect(advisoryApi.write(changed)).rejects.toMatchObject({ data: { error: { code: 'write_review_required' } } }); expect(fetch).toHaveBeenCalledTimes(1); }
  fetch.mockResolvedValueOnce(json({ data: { ...receipt(original), replayed: true } })); await advisoryApi.write(original); expect(fetch.mock.calls[1][0]).toBe(first[0]); expect(fetch.mock.calls[1][1].body).toBe(first[1].body); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
it.each(['missing', 'malformed', 'wrong-task'])('does not clear a missing or invalid %s immutable lookup', async (fault) => {
  const original = command('decision', 'acknowledged_unresolved'); fetch.mockRejectedValueOnce(new TypeError('Synthetic saved result lost')); const unknown = await advisoryApi.write(original).catch((error) => error);
  const value = receipt(original); if (fault === 'malformed') value.advisory.decision.reason = 'Different synthetic reason'; if (fault === 'wrong-task') value.advisory.id = ids[20]; fetch.mockResolvedValueOnce(fault === 'missing' ? json({ error: { code: 'not_found', message: 'Synthetic missing' } }, 404) : json({ data: value })); await expect(advisoryApi.recover(original)).rejects.toBeDefined(); expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
  fetch.mockResolvedValueOnce(json({ data: receipt(original) })); await advisoryApi.recover(original); acknowledgeWriteResponse(unknown); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
it.each(['generic409', 'malformed2xx'])('retains %s uncertainty after a new controller mounts', async (fault) => {
  const original = command(); const value = receipt(original); value.advisory.notes = 'Different synthetic saved note'; fetch.mockResolvedValueOnce(fault === 'generic409' ? json({ error: { code: 'admission_advisory_write_unconfirmed', message: 'Synthetic storage uncertainty' } }, 409) : json({ data: value })); await expect(advisoryApi.write(original)).rejects.toMatchObject({ name: 'AdvisoryUnconfirmedError' }); resetWriteUncertaintyForTests({ preserveStorage: true }); activate(); await expect(advisoryApi.write({ ...original, payload: { ...original.payload, client_request_id: ids[20] } })).rejects.toMatchObject({ data: { error: { code: 'write_review_required' } } }); expect(fetch).toHaveBeenCalledTimes(1);
});
it('requires a fresh rich read of the same case, excluding case selection/context and another case', async () => {
  const original = command(); fetch.mockRejectedValueOnce(new TypeError('Synthetic response lost')); await expect(advisoryApi.write(original)).rejects.toBeDefined();
  fetch.mockResolvedValueOnce(json({ data: [caseRow()], page: { has_next: false, next_cursor: null } })); await advisoryApi.cases(patientId, { limit: 25 }); expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(false);
  fetch.mockResolvedValueOnce(json({ data: context() })); await advisoryApi.context({ patientId, caseId }); expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(false);
  fetch.mockResolvedValueOnce(json({ data: detail({ admission_case_id: otherCaseId }) })); await advisoryApi.detail({ patientId, caseId: otherCaseId }, advisoryId); expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(false);
  fetch.mockResolvedValueOnce(json({ data: detail() })); await advisoryApi.detail({ patientId, caseId }, advisoryId); expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(true); expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
  await expect(advisoryApi.write({ ...original, payload: { ...original.payload, client_request_id: ids[20] } })).rejects.toMatchObject({ data: { error: { code: 'write_review_required' } } }); expect(fetch).toHaveBeenCalledTimes(5);
});
it('does not allow an extra route suffix to inherit exact-retry safety', async () => {
  const request = { method: 'POST', path: '/api/v2/patients/{patient_id}/chronicle/admissions/{case_id}/advisories/extra', pathParams: { patient_id: patientId, case_id: caseId }, body: command().payload }; fetch.mockRejectedValueOnce(new TypeError('Synthetic unsupported write loss')); await expect(v2Request(request)).rejects.toBeDefined(); await expect(v2Request(request)).rejects.toMatchObject({ data: { error: { code: 'write_review_required' } } }); expect(fetch).toHaveBeenCalledTimes(1);
});
