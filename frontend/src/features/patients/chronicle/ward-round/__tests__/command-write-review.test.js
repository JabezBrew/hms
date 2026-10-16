import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { v2Request, configureV2ApiClient, __resetV2ApiClientForTests, getV2ClientScopeKey } from '@/lib/api/v2/client';
import { bindNetworkAccessGuard } from '@/lib/api/v2/networkAccessGuard';
import { activateWriteUncertainty, getWriteUncertaintySnapshot, resetWriteUncertaintyForTests, WRITE_UNCERTAINTY_KEY } from '@/lib/api/v2/writeUncertainty';
import { roundCommandApi } from '../commandApi';
import { buildRoundDraft } from '../commandModel';
import { roundForm } from '../roundForm';
import { actor, ids, patientId, admissionId, receipt } from './command-fixtures';
const runtime = window.__HMS_RUNTIME_CONFIG__; const originalFetch = globalThis.fetch;
const principal = { id: actor.id, facility_id: ids[1], active_profile: 'hospital' };
const json = (data) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
function activate(token = 'SYNTHETIC-ROUND-TOKEN') {
  configureV2ApiClient({ getAccessToken: () => token, getFacilityCode: () => 'HMS', canRefreshSession: () => false });
  bindNetworkAccessGuard({ transportScope: getV2ClientScopeKey(), authorityScope: 'synthetic-round-authority', principal }).update({ confirmed: true, decision: { access_allowed: true, read_only: false, classification: 'onsite', policy_version: 1 } }); activateWriteUncertainty(principal);
}
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' }; activate(); globalThis.fetch = vi.fn(); });
afterEach(() => { __resetV2ApiClientForTests(); vi.unstubAllGlobals(); globalThis.fetch = originalFetch; window.__HMS_RUNTIME_CONFIG__ = runtime; });
it.each(['draft', 'commit'])('keeps %s opaque after response loss/reload/reauth and permits only exact UUID/body retry', async (kind) => {
  const wire = buildRoundDraft({ ...roundForm(patientId, admissionId, null), renderedNote: 'Synthetic private reviewed narrative' }, null, ids[8]);
  const source = receipt(wire).ward_round;
  const command = kind === 'draft' ? { kind, patientId, admissionId, actorId: actor.id, wire } : { kind, patientId, admissionId, actorId: actor.id, roundId: source.id, wire: { client_request_id: ids[9], expected_version: source.version }, reviewed: { note_sections: source.note_sections, rendered_note: source.rendered_note, actions: [] } };
  globalThis.fetch.mockRejectedValueOnce(new TypeError('Synthetic lost result')); await expect(roundCommandApi.write(command)).rejects.toMatchObject({ name: 'WardRoundUnconfirmedError' });
  const first = globalThis.fetch.mock.calls[0]; const stored = sessionStorage.getItem(WRITE_UNCERTAINTY_KEY); for (const value of [patientId, admissionId, actor.id, source.id, 'Synthetic private reviewed narrative', 'SYNTHETIC-ROUND-TOKEN']) expect(stored).not.toContain(value);
  resetWriteUncertaintyForTests({ preserveStorage: true }); activate('SYNTHETIC-ROTATED-ROUND-TOKEN');
  for (const changed of [{ ...command.wire, client_request_id: ids[11] }, kind === 'draft' ? { ...command.wire, rendered_note: 'Synthetic changed intent' } : { ...command.wire, expected_version: 2 }]) {
    await expect(roundCommandApi.write({ ...command, wire: changed })).rejects.toMatchObject({ data: { error: { code: 'write_review_required' } } }); expect(fetch).toHaveBeenCalledTimes(1);
  }
  globalThis.fetch.mockResolvedValueOnce(json({ data: { ...receipt(command.wire, kind, kind === 'commit' ? source : null), replayed: true } }));
  await roundCommandApi.write(command); expect(globalThis.fetch.mock.calls[1][0]).toBe(first[0]); expect(globalThis.fetch.mock.calls[1][1].body).toBe(first[1].body); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
it('does not count admission eligibility as review of an uncertain fluid observation', async () => {
  globalThis.fetch.mockRejectedValueOnce(new TypeError('Synthetic fluid response lost'));
  await expect(v2Request({ method: 'POST', path: '/api/v2/nursing/fluid-observations', body: { client_request_id: ids[8], patient_id: patientId, admission_case_id: admissionId, intake_ml: 100 } })).rejects.toBeDefined();
  expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
  globalThis.fetch.mockResolvedValueOnce(json({ data: { patient_id: patientId, admission_case_id: admissionId, status: 'admitted', can_record_observation: true } }));
  await v2Request({ path: '/api/v2/nursing/fluid-observations/context', query: { patient_id: patientId, admission_case_id: admissionId } }); expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(false);
  globalThis.fetch.mockResolvedValueOnce(json({ data: [], page: { has_next: false, next_cursor: null } }));
  await v2Request({ path: '/api/v2/nursing/fluid-observations', query: { patient_id: patientId, admission_case_id: admissionId } }); expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(true); expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
});
