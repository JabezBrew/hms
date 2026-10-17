import { webcrypto } from 'node:crypto';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { configureV2ApiClient, __resetV2ApiClientForTests, getV2ClientScopeKey, v2Request } from '@/lib/api/v2/client';
import { bindNetworkAccessGuard, isNetworkWorkflowWrite } from '@/lib/api/v2/networkAccessGuard';
import { activateWriteUncertainty, getWriteUncertaintySnapshot, acknowledgeWriteReview } from '@/lib/api/v2/writeUncertainty';
import { previewNoteTemplate } from '../api/templatePreview';
import { actorId, encounterId, facilityId, ids, json, patientId, revision } from './fixtures';
const initialRuntime = window.__HMS_RUNTIME_CONFIG__; const originalFetch = globalThis.fetch;
const principal = { id: actorId, facility_id: facilityId, active_profile: 'hospital' };
const input = { patientId, encounterId, revision, body: '', mode: 'empty_only', chiefComplaint: 'Synthetic complaint' };
const value = { patient_id: patientId, encounter_id: encounterId, template_id: revision.template_id, template_revision_id: revision.id, template_revision_version: 1, rendered_on: '2026-10-17', date_basis: 'utc', kind: 'structured', patch: { assessment: 'Synthetic generated text' }, applied_sections: ['assessment'], unresolved: [], unresolved_truncated: false };
let guard;
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' }; configureV2ApiClient({ getAccessToken: () => 'SYNTHETIC-PREVIEW-TOKEN', getFacilityCode: () => 'HMS', canRefreshSession: () => false }); guard = bindNetworkAccessGuard({ transportScope: getV2ClientScopeKey(), authorityScope: 'synthetic-preview-scope', principal }); guard.update({ confirmed: true, decision: { access_allowed: true, read_only: true, classification: 'offsite', mode: 'read_only', policy_version: 1 } }); activateWriteUncertainty(principal); globalThis.fetch = vi.fn(); });
afterEach(() => { __resetV2ApiClientForTests(); vi.unstubAllGlobals(); globalThis.fetch = originalFetch; window.__HMS_RUNTIME_CONFIG__ = initialRuntime; });
it('uses the real generated POST preview under read-only access with exact selected context and no uncertainty command', async () => {
  const signal = new AbortController().signal; fetch.mockResolvedValueOnce(json({ data: value })); await expect(previewNoteTemplate(input, { signal })).resolves.toMatchObject({ preview: value });
  const [url, options] = fetch.mock.calls[0]; expect(url).toContain(`/patients/${patientId}/clinical/note-template-previews`); expect(options.method).toBe('POST'); expect(options.signal).toBe(signal); const payload = JSON.parse(options.body); expect(payload).toMatchObject({ template_id: revision.template_id, template_revision_id: revision.id, encounter_id: encounterId, base_body: '', chief_complaint: 'Synthetic complaint' }); expect(payload).not.toHaveProperty('client_request_id'); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
it('classifies only the exact POST route as read, including generated and concrete path forms', () => {
  expect(isNetworkWorkflowWrite('POST', '/api/v2/patients/{patient_id}/clinical/note-template-previews')).toBe(false); expect(isNetworkWorkflowWrite('POST', `/api/v2/patients/${patientId}/clinical/note-template-previews`)).toBe(false);
  for (const path of [`/api/v2/patients/${patientId}/clinical/note-template-previews/extra`, `/api/v2/patients/${patientId}/clinical/notes/record`]) expect(isNetworkWorkflowWrite('POST', path)).toBe(true); expect(isNetworkWorkflowWrite('PATCH', `/api/v2/patients/${patientId}/clinical/note-template-previews`)).toBe(true);
});
it.each([403, 400, 500])('publishes no fake fallback or write marker for a rejected preview (%s)', async (status) => { fetch.mockResolvedValueOnce(json({ error: { code: 'preview_unavailable', message: 'Preview unavailable.' } }, status)); await expect(previewNoteTemplate(input)).rejects.toMatchObject({ status }); expect(fetch).toHaveBeenCalledTimes(1); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0); });
it('preserves AbortError and rejects wrong valid patient/context/revision response without write uncertainty', async () => {
  const error = new DOMException('Cancelled', 'AbortError'); fetch.mockRejectedValueOnce(error); await expect(previewNoteTemplate(input)).rejects.toBe(error);
  for (const wrong of [{ patient_id: ids[20] }, { encounter_id: null }, { template_revision_id: ids[20] }]) { fetch.mockResolvedValueOnce(json({ data: { ...value, ...wrong } })); await expect(previewNoteTemplate(input)).rejects.toThrow(/could not be confirmed/); }
  expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
it('never acknowledges, clears or marks an earlier uncertain patient write as reviewed', async () => {
  guard.update({ confirmed: true, decision: { access_allowed: true, read_only: false, classification: 'onsite', policy_version: 1 } }); fetch.mockRejectedValueOnce(new TypeError('Synthetic lost write'));
  await expect(v2Request({ method: 'POST', path: '/api/v2/patients/{patient_id}/clinical/notes/record', pathParams: { patient_id: patientId }, body: { client_request_id: ids[20], body: 'Synthetic local work' } })).rejects.toBeDefined();
  const original = getWriteUncertaintySnapshot().entries[0]; expect(original.reviewed).toBe(false); guard.update({ confirmed: true, decision: { access_allowed: true, read_only: true, classification: 'offsite', mode: 'read_only', policy_version: 1 } });
  fetch.mockResolvedValueOnce(json({ data: value })); await previewNoteTemplate(input); expect(getWriteUncertaintySnapshot().entries).toHaveLength(1); expect(getWriteUncertaintySnapshot().entries[0]).toEqual(original); await expect(acknowledgeWriteReview(original.id, principal)).rejects.toBeDefined();
});
