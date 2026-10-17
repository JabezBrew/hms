import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { configureV2ApiClient, __resetV2ApiClientForTests, getV2ClientScopeKey } from '@/lib/api/v2/client';
import { bindNetworkAccessGuard } from '@/lib/api/v2/networkAccessGuard';
import { acknowledgeWriteResponse, activateWriteUncertainty, getWriteUncertaintySnapshot, resetWriteUncertaintyForTests, WRITE_UNCERTAINTY_KEY } from '@/lib/api/v2/writeUncertainty';
import { treatmentApi } from '../api';
import { actorId, facilityId, patientId, caseId, otherCaseId, ids, command, context, detail, receipt, json } from './fixtures';
const runtime = window.__HMS_RUNTIME_CONFIG__; const oldFetch = globalThis.fetch;
const principal = { id: actorId, facility_id: facilityId, active_profile: 'hospital' };
function activate(token = 'SYNTHETIC-PRIVATE-TREATMENT-TOKEN') { configureV2ApiClient({ getAccessToken: () => token, getFacilityCode: () => 'HMS', canRefreshSession: () => false }); bindNetworkAccessGuard({ transportScope: getV2ClientScopeKey(), authorityScope: 'synthetic-treatment-authority', principal }).update({ confirmed: true, decision: { classification: 'onsite', access_allowed: true, read_only: false, policy_version: 1 } }); activateWriteUncertainty(principal); }
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' }; activate(); globalThis.fetch = vi.fn(); });
afterEach(() => { __resetV2ApiClientForTests(); vi.unstubAllGlobals(); globalThis.fetch = oldFetch; window.__HMS_RUNTIME_CONFIG__ = runtime; });
it.each(['stop', 'window'])('keeps opaque %s uncertainty after reload/rotation and allows only the exact request retry', async (kind) => {
  const original = command(kind); fetch.mockRejectedValueOnce(new TypeError('Synthetic saved response lost')); await expect(treatmentApi.write(original)).rejects.toMatchObject({ name: 'TreatmentWriteUnconfirmedError' }); const first = fetch.mock.calls[0]; expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
  const stored = sessionStorage.getItem(WRITE_UNCERTAINTY_KEY); for (const value of [actorId, patientId, caseId, original.source.summary.id, original.payload.reason, original.source.source_instructions, original.payload.expected_source_token, 'SYNTHETIC-PRIVATE-TREATMENT-TOKEN'].filter(Boolean)) expect(stored).not.toContain(value);
  resetWriteUncertaintyForTests({ preserveStorage: true }); activate('SYNTHETIC-ROTATED-TREATMENT-TOKEN');
  const variants = [{ ...original, payload: { ...original.payload, client_request_id: ids[24] } }, { ...original, payload: { ...original.payload, ...(kind === 'stop' ? { reason: 'Different synthetic decision' } : { note: 'Different synthetic review' }) } }, { ...original, caseId: otherCaseId }, { ...original, source: { ...original.source, summary: { ...original.source.summary, id: ids[25] } } }];
  for (const changed of variants) { await expect(treatmentApi.write(changed)).rejects.toMatchObject({ data: { error: { code: 'write_review_required' } } }); expect(fetch).toHaveBeenCalledTimes(1); }
  fetch.mockResolvedValueOnce(json({ data: { ...receipt(original), replayed: true } })); await treatmentApi.write(original); expect(fetch.mock.calls[1][0]).toBe(first[0]); expect(fetch.mock.calls[1][1].body).toBe(first[1].body); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
it.each(['missing', 'wrong-case', 'wrong-membership'])('does not clear uncertainty on %s lookup; exact recovery acknowledges only the original opaque handle', async (fault) => {
  const original = command(fault === 'wrong-membership' ? 'window' : 'stop'); fetch.mockRejectedValueOnce(new TypeError('Synthetic saved response lost')); const unknown = await treatmentApi.write(original).catch((error) => error); const value = receipt(original); if (fault === 'wrong-case') value.admission_case_id = otherCaseId; if (fault === 'wrong-membership') value.result.created_doses[0].scheduled_at = original.payload.scheduled_before;
  fetch.mockResolvedValueOnce(fault === 'missing' ? json({ error: { code: 'not_found', message: 'Synthetic missing result' } }, 404) : json({ data: value })); await expect(treatmentApi.recover(original)).rejects.toBeDefined(); expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
  fetch.mockResolvedValueOnce(json({ data: receipt(original) })); await treatmentApi.recover(original); expect(getWriteUncertaintySnapshot().entries).toHaveLength(1); acknowledgeWriteResponse(unknown); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
it.each(['generic409', 'malformed2xx'])('retains %s after controller replacement instead of allowing a duplicate decision', async (fault) => {
  const original = command(); const value = receipt(original); value.result.ward_name = 'Different synthetic ward'; fetch.mockResolvedValueOnce(fault === 'generic409' ? json({ error: { code: 'treatment_course_write_unconfirmed', message: 'Synthetic commit uncertainty' } }, 409) : json({ data: value })); await expect(treatmentApi.write(original)).rejects.toMatchObject({ name: 'TreatmentWriteUnconfirmedError' }); resetWriteUncertaintyForTests({ preserveStorage: true }); activate(); await expect(treatmentApi.write({ ...original, payload: { ...original.payload, client_request_id: ids[24] } })).rejects.toMatchObject({ data: { error: { code: 'write_review_required' } } }); expect(fetch).toHaveBeenCalledTimes(1);
});
it('excludes minimal context and another course from related review; rich same-course response still never auto-confirms a save', async () => {
  const original = command(); fetch.mockRejectedValueOnce(new TypeError('Synthetic response lost')); await expect(treatmentApi.write(original)).rejects.toBeDefined();
  fetch.mockResolvedValueOnce(json({ data: context() })); await treatmentApi.context(original); expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(false);
  fetch.mockResolvedValueOnce(json({ data: detail({ summary: { ...detail().summary, id: ids[24] } }) })); await treatmentApi.detail({ ...original, courseId: ids[24] }); expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(false);
  fetch.mockResolvedValueOnce(json({ data: detail() })); await treatmentApi.detail({ ...original, courseId: original.source.summary.id }); expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(true); expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
});
