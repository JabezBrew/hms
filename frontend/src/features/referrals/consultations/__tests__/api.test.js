import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { __resetV2ApiClientForTests, configureV2ApiClient, getV2ClientScopeKey } from '@/lib/api/v2/client';
import { bindNetworkAccessGuard } from '@/lib/api/v2/networkAccessGuard';
import { activateWriteUncertainty, getWriteUncertaintySnapshot } from '@/lib/api/v2/writeUncertainty';
import { consultationApi } from '../api';
import { consultationCommand, inputDigest, redactedIntent } from '../model';
import { actorId, at, context, facilityId, link, otherId, requestId, scope, selected, source } from './fixtures';
const runtime = window.__HMS_RUNTIME_CONFIG__, originalFetch = globalThis.fetch;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
let command, receipt;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' };
  configureV2ApiClient({ getAccessToken: () => 'SYNTHETIC-CONSULTATION-TOKEN', getFacilityCode: () => 'QA', canRefreshSession: () => false });
  const principal = { id: actorId, facility_id: facilityId, active_profile: 'hospital' }, binding = { transportScope: getV2ClientScopeKey(), authorityScope: 'synthetic-consultation', principal };
  bindNetworkAccessGuard(binding).update({ confirmed: true, decision: { access_allowed: true, read_only: false, classification: 'onsite', policy_version: 1 } }); activateWriteUncertainty(principal, { authority: binding.authorityScope, transport: binding.transportScope });
  globalThis.fetch = vi.fn(); command = await consultationCommand({ scope, source: selected, selection: source, requestId, actorId });
  receipt = { client_request_id: requestId, replayed: false, recorded_at: at, input_digest: await inputDigest(command.payload), reviewed_input: redactedIntent(command.payload), link: structuredClone(link) };
});
afterEach(() => { __resetV2ApiClientForTests(); vi.unstubAllGlobals(); globalThis.fetch = originalFetch; window.__HMS_RUNTIME_CONFIG__ = runtime; });
it('uses all three actual generated methods with explicit nested patient/referral scope and source query', async () => {
  fetch.mockResolvedValueOnce(json({ data: context })); expect(await consultationApi.context(scope)).toEqual(context);
  const controller = new AbortController(); fetch.mockResolvedValueOnce(json({ data: selected })); await consultationApi.context(scope, source, { signal: controller.signal });
  fetch.mockResolvedValueOnce(json({ data: receipt })); await consultationApi.write(command);
  fetch.mockResolvedValueOnce(json({ data: { ...receipt, replayed: true } })); await consultationApi.recover(command);
  const paths = fetch.mock.calls.map(([url]) => new URL(url).pathname), base = `/api/v2/patients/${scope.patientId}/referrals/${scope.referralId}/consultation`;
  expect(paths).toEqual([base, base, `${base}/start`, `${base}/requests/${requestId}`]);
  expect(new URL(fetch.mock.calls[0][0]).search).toBe(''); expect(new URL(fetch.mock.calls[1][0]).searchParams.get('mode')).toBe('new_outpatient'); expect(new URL(fetch.mock.calls[1][0]).searchParams.get('visit_choice')).toBe('no_visit'); expect(fetch.mock.calls[1][1].signal).toBe(controller.signal); expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual(command.payload); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
it.each(['patient', 'referral', 'actor', 'digest', 'intent', 'source', 'capability'])('keeps a malformed successful %s reply unconfirmed without silently retrying', async fault => {
  const bad = structuredClone(receipt);
  if (fault === 'patient') bad.link.patient_id = otherId;
  if (fault === 'referral') bad.link.referral_id = otherId;
  if (fault === 'actor') bad.link.recorded_by_user_id = otherId;
  if (fault === 'digest') bad.input_digest = 'c'.repeat(64);
  if (fault === 'intent') bad.reviewed_input.source.visit = { choice: 'existing_visit', visit_id: otherId };
  if (fault === 'source') bad.link.resulting_referral_status = 'completed';
  if (fault === 'capability') bad.can_resume = true;
  fetch.mockResolvedValueOnce(json({ data: bad })); await expect(consultationApi.write(command)).rejects.toMatchObject({ name: 'ConsultationUnconfirmedError' }); expect(fetch).toHaveBeenCalledTimes(1); expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
});
it.each([400, 403, 409])('preserves a definite%s rejection and performs no automatic retry', async status => {
  fetch.mockResolvedValueOnce(json({ error: { code: 'referral_consultation_source_changed', message: 'Synthetic exact current refusal', details: {} } }, status)); await expect(consultationApi.write(command)).rejects.toMatchObject({ status }); expect(fetch).toHaveBeenCalledTimes(1); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
it('retains server write-unconfirmed409 and only permits unchanged UUID/body retry', async () => {
  fetch.mockResolvedValueOnce(json({ error: { code: 'referral_consultation_write_unconfirmed', message: 'Synthetic unknown result', details: {} } }, 409)); await expect(consultationApi.write(command)).rejects.toMatchObject({ name: 'ConsultationUnconfirmedError' });
  const changed = await consultationCommand({ scope, source: selected, selection: source, requestId: otherId, actorId }); await expect(consultationApi.write(changed)).rejects.toMatchObject({ status: 409 }); expect(fetch).toHaveBeenCalledTimes(1);
  fetch.mockResolvedValueOnce(json({ data: { ...receipt, replayed: true } })); await consultationApi.write(command); expect(fetch).toHaveBeenCalledTimes(2); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
it('preserves read AbortError without converting it into a generic or uncertain write error', async () => { const aborted = new DOMException('Synthetic canceled read', 'AbortError'); fetch.mockRejectedValueOnce(aborted); await expect(consultationApi.context(scope)).rejects.toMatchObject({ name: 'AbortError' }); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0); });
