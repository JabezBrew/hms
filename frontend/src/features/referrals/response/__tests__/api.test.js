import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { __resetV2ApiClientForTests, configureV2ApiClient, getV2ClientScopeKey } from '@/lib/api/v2/client';
import { bindNetworkAccessGuard } from '@/lib/api/v2/networkAccessGuard';
import { activateWriteUncertainty, getWriteUncertaintySnapshot } from '@/lib/api/v2/writeUncertainty';
import { referralResponseApi } from '../api';
import { responseCommand } from '../model';
import { actorId, context, laterId, metadata, receipt, requestId, revision, revisionId, scope } from './fixtures';
const runtime = window.__HMS_RUNTIME_CONFIG__, originalFetch = globalThis.fetch;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
let command;
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto); __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' };
  configureV2ApiClient({ getAccessToken: () => 'SYNTHETIC-RESPONSE-TOKEN', getFacilityCode: () => 'QA', canRefreshSession: () => false });
  const principal = { id: actorId, facility_id: laterId, active_profile: 'hospital' }; const binding = { transportScope: getV2ClientScopeKey(), authorityScope: 'synthetic-response', principal }; bindNetworkAccessGuard(binding).update({ confirmed: true, decision: { access_allowed: true, read_only: false, classification: 'onsite', policy_version: 1 } }); activateWriteUncertainty(principal, { authority: binding.authorityScope, transport: binding.transportScope });
  globalThis.fetch = vi.fn(); command = responseCommand({ scope, source: context, operation: 'save_draft', specialistNotes: revision.specialist_notes, recommendations: revision.recommendations, requestId, actorId });
});
afterEach(() => { __resetV2ApiClientForTests(); vi.unstubAllGlobals(); globalThis.fetch = originalFetch; window.__HMS_RUNTIME_CONFIG__ = runtime; });
it('uses all five actual generated operations with exact context and bounded history query', async () => {
  fetch.mockResolvedValueOnce(json({ data: context })); expect(await referralResponseApi.context(scope)).toEqual(context);
  fetch.mockResolvedValueOnce(json({ data: [metadata()], page: { limit: 25, has_next: false, next_cursor: null } })); await referralResponseApi.history(scope, { cursor: 'v:3' });
  fetch.mockResolvedValueOnce(json({ data: revision })); await referralResponseApi.version(scope, revisionId);
  fetch.mockResolvedValueOnce(json({ data: receipt })); await referralResponseApi.write(command);
  fetch.mockResolvedValueOnce(json({ data: { ...receipt, replayed: true } })); await referralResponseApi.recover(command);
  const paths = fetch.mock.calls.map(([url]) => new URL(url).pathname); const base = `/api/v2/patients/${scope.patientId}/referrals/${scope.referralId}/response`;
  expect(paths).toEqual([base, `${base}/history`, `${base}/versions/${revisionId}`, `${base}/commands`, `${base}/requests/${requestId}`]);
  expect(new URL(fetch.mock.calls[1][0]).searchParams.get('cursor')).toBe('v:3'); expect(JSON.parse(fetch.mock.calls[3][1].body)).toEqual(command.payload); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
it.each(['patient', 'actor', 'notes', 'version', 'operation', 'capability'])('marks a malformed2xx %s receipt uncertain without accepting it as success', async fault => {
  const bad = structuredClone(receipt); if (fault === 'patient') bad.response.patient_id = laterId; if (fault === 'actor') bad.response.recorded_by_user_id = laterId; if (fault === 'notes') bad.response.specialist_notes = 'Different synthetic evidence'; if (fault === 'version') bad.response.version = 2; if (fault === 'operation') bad.operation = 'completed'; if (fault === 'capability') bad.can_complete = true;
  fetch.mockResolvedValueOnce(json({ data: bad })); await expect(referralResponseApi.write(command)).rejects.toMatchObject({ name: 'ReferralResponseUnconfirmedError' }); expect(getWriteUncertaintySnapshot().entries).toHaveLength(1); expect(fetch).toHaveBeenCalledTimes(1);
});
it.each([400,403,409])('retains precise definite%s rejection without creating an unknown marker', async status => {
  fetch.mockResolvedValueOnce(json({ error: { code: 'referral_response_source_changed', message: 'Synthetic current refusal', details: {} } }, status)); await expect(referralResponseApi.write(command)).rejects.toMatchObject({ status }); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
it('retains server unknown409 and only permits the same exact request UUID/body retry', async () => {
  fetch.mockResolvedValueOnce(json({ error: { code: 'referral_response_write_unconfirmed', message: 'Synthetic unknown', details: {} } }, 409)); await expect(referralResponseApi.write(command)).rejects.toMatchObject({ name: 'ReferralResponseUnconfirmedError' });
  await expect(referralResponseApi.write({ ...command, payload: { ...command.payload, client_request_id: laterId } })).rejects.toMatchObject({ status: 409 }); expect(fetch).toHaveBeenCalledTimes(1);
  fetch.mockResolvedValueOnce(json({ data: { ...receipt, replayed: true } })); await referralResponseApi.write(command); expect(fetch).toHaveBeenCalledTimes(2); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
it('preserves AbortSignal on reads and rejects wrong-but-valid exact revision context', async () => {
  const controller = new AbortController(); fetch.mockResolvedValueOnce(json({ data: { ...revision, referral_id: laterId } })); await expect(referralResponseApi.version(scope, revisionId, { signal: controller.signal })).rejects.toThrow(/exact referral/); expect(fetch.mock.calls[0][1].signal).toBe(controller.signal);
});
