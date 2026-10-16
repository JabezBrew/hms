import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { configureV2ApiClient, __resetV2ApiClientForTests, getV2ClientScopeKey } from '@/lib/api/v2/client';
import { bindNetworkAccessGuard } from '@/lib/api/v2/networkAccessGuard';
import { activateWriteUncertainty, acknowledgeWriteResponse, getWriteUncertaintySnapshot, resetWriteUncertaintyForTests, WRITE_UNCERTAINTY_KEY } from '@/lib/api/v2/writeUncertainty';
import { noteWorkspaceApi } from '../api/workspace';
import { actorId, body, command, facilityId, ids, json, noteId, patientId, receipt, templateId } from './fixtures';
const runtime = window.__HMS_RUNTIME_CONFIG__; const originalFetch = globalThis.fetch;
const principal = { id: actorId, facility_id: facilityId, active_profile: 'hospital' };
function activate(token = 'SYNTHETIC-PRIVATE-TOKEN') { configureV2ApiClient({ getAccessToken: () => token, getFacilityCode: () => 'HMS', canRefreshSession: () => false }); const guard = bindNetworkAccessGuard({ transportScope: getV2ClientScopeKey(), authorityScope: 'synthetic-note-authority', principal }); guard.update({ confirmed: true, decision: { access_allowed: true, read_only: false, classification: 'onsite', policy_version: 1 } }); activateWriteUncertainty(principal); }
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' }; activate(); globalThis.fetch = vi.fn(); });
afterEach(() => { __resetV2ApiClientForTests(); vi.unstubAllGlobals(); globalThis.fetch = originalFetch; window.__HMS_RUNTIME_CONFIG__ = runtime; });
it.each(['record', 'amend', 'templateRecord', 'templateChange'])('retains an opaque %s after lost response and same-actor reauth; only exact UUID/body can retry', async (kind) => {
  const original = command(kind); globalThis.fetch.mockRejectedValueOnce(new TypeError('Synthetic lost reply'));
  await expect(noteWorkspaceApi.write(original)).rejects.toMatchObject({ name: 'ClinicalNoteUnconfirmedError' }); const first = globalThis.fetch.mock.calls[0]; expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
  const stored = sessionStorage.getItem(WRITE_UNCERTAINTY_KEY); for (const secret of [patientId, noteId, templateId, actorId, body, original.payload.title, 'SYNTHETIC-PRIVATE-TOKEN'].filter(Boolean)) expect(stored).not.toContain(secret);
  resetWriteUncertaintyForTests({ preserveStorage: true }); activate('SYNTHETIC-ROTATED-TOKEN');
  for (const payload of [{ ...original.payload, client_request_id: ids[22] }, { ...original.payload, ...(kind.startsWith('template') ? { title: 'Different synthetic template' } : { body: 'Different synthetic body' }) }]) {
    await expect(noteWorkspaceApi.write({ ...original, payload })).rejects.toMatchObject({ data: { error: { code: 'write_review_required' } } }); expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  }
  globalThis.fetch.mockResolvedValueOnce(json({ data: { ...receipt(original), replayed: true } })); await noteWorkspaceApi.write(original); expect(globalThis.fetch.mock.calls[1][0]).toBe(first[0]); expect(globalThis.fetch.mock.calls[1][1].body).toBe(first[1].body); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
it.each(['missing', 'malformed', 'wrong-reason'])('does not clear original uncertainty for a %s saved-result lookup', async (fault) => {
  const original = command('amend'); globalThis.fetch.mockRejectedValueOnce(new TypeError('Synthetic lost reply')); const error = await noteWorkspaceApi.write(original).catch((value) => value);
  if (fault === 'missing') globalThis.fetch.mockResolvedValueOnce(json({ error: { code: 'not_found' } }, 404)); else { const value = receipt(original); if (fault === 'malformed') value.note.body = 'Wrong synthetic body'; else value.reason = 'Different synthetic reason'; globalThis.fetch.mockResolvedValueOnce(json({ data: value })); }
  await expect(noteWorkspaceApi.recover(original)).rejects.toBeDefined(); expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
  globalThis.fetch.mockResolvedValueOnce(json({ data: receipt(original) })); await noteWorkspaceApi.recover(original); acknowledgeWriteResponse(error); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
it.each(['record', 'amend', 'templateRecord', 'templateChange'])('preserves typed malformed 2xx %s uncertainty after reload', async (kind) => {
  const original = command(kind); const value = receipt(original); value.client_request_id = ids[22]; globalThis.fetch.mockResolvedValueOnce(json({ data: value })); await expect(noteWorkspaceApi.write(original)).rejects.toMatchObject({ name: 'ClinicalNoteUnconfirmedError' }); resetWriteUncertaintyForTests({ preserveStorage: true }); activate();
  await expect(noteWorkspaceApi.write({ ...original, payload: { ...original.payload, client_request_id: ids[23] } })).rejects.toMatchObject({ data: { error: { code: 'write_review_required' } } }); expect(globalThis.fetch).toHaveBeenCalledTimes(1);
});
