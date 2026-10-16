import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { configureV2ApiClient, __resetV2ApiClientForTests, getV2ClientScopeKey } from '@/lib/api/v2/client';
import { bindNetworkAccessGuard } from '@/lib/api/v2/networkAccessGuard';
import { activateWriteUncertainty, getWriteUncertaintySnapshot, resetWriteUncertaintyForTests, WRITE_UNCERTAINTY_KEY, acknowledgeWriteResponse } from '@/lib/api/v2/writeUncertainty';
import { handoverApi } from '../api';
import { command, receipt, json, ids, patientId, admissionId, narrative, actorId, detail } from './fixtures';
const principal = { id: actorId, facility_id: ids[10], active_profile: 'hospital' };
const runtime = window.__HMS_RUNTIME_CONFIG__; const originalFetch = globalThis.fetch;
function activate() { const guard = bindNetworkAccessGuard({ transportScope: getV2ClientScopeKey(), authorityScope: 'synthetic-handover-authority', principal }); guard.update({ confirmed: true, decision: { access_allowed: true, read_only: false, classification: 'onsite', policy_version: 1 } }); activateWriteUncertainty(principal); }
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' }; configureV2ApiClient({ getAccessToken: () => 'SYNTHETIC-PRIVATE-TOKEN', getFacilityCode: () => 'HMS', canRefreshSession: () => false }); activate(); globalThis.fetch = vi.fn(); });
afterEach(() => { __resetV2ApiClientForTests(); vi.unstubAllGlobals(); globalThis.fetch = originalFetch; window.__HMS_RUNTIME_CONFIG__ = runtime; });
it.each(['lost', 'generic409', 'malformed'])('keeps an opaque unresolved handover %s across reload/reauth and blocks a different new UUID', async (failure) => {
  if (failure === 'lost') globalThis.fetch.mockRejectedValueOnce(new TypeError('Synthetic lost reply'));
  if (failure === 'generic409') globalThis.fetch.mockResolvedValueOnce(json({ error: { code: 'patient_handover_write_unconfirmed' } }, 409));
  if (failure === 'malformed') globalThis.fetch.mockResolvedValueOnce(json({ data: { ...receipt(), handover: { ...receipt().handover, revision: 5 } } }));
  const error = await handoverApi.write(command).catch((value) => value); expect(error.name).toBe('HandoverUnconfirmedError'); expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
  const stored = sessionStorage.getItem(WRITE_UNCERTAINTY_KEY); for (const secret of [patientId, admissionId, actorId, narrative.patient_condition, 'SYNTHETIC-PRIVATE-TOKEN']) expect(stored).not.toContain(secret);
  resetWriteUncertaintyForTests({ preserveStorage: true }); activate(); const next = { ...command, payload: { ...command.payload, client_request_id: ids[11] } };
  await expect(handoverApi.write(next)).rejects.toMatchObject({ data: { error: { code: 'write_review_required' } } }); expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  globalThis.fetch.mockResolvedValueOnce(json({ data: { ...receipt(), replayed: true } })); await handoverApi.recover(command); acknowledgeWriteResponse(error); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
  globalThis.fetch.mockResolvedValueOnce(json({ data: receipt(next) })); await handoverApi.write(next); expect(globalThis.fetch).toHaveBeenCalledTimes(3);
});

it.each(['record','amend','void'])('retries the exact original %s UUID/body after lost response and same-actor reauth, blocking a changed key or payload', async(kind)=>{
  const original = kind === 'record' ? command : { ...command, kind, source: detail, payload: kind === 'amend' ? {client_request_id:command.payload.client_request_id,expected_revision:1,shift_date:command.payload.shift_date,shift_type:'evening',intended_recipient_user_id:null,narrative,reason:'Synthetic correction'} : {client_request_id:command.payload.client_request_id,expected_revision:1,reason:'Synthetic void'} };
  globalThis.fetch.mockRejectedValueOnce(new TypeError('Synthetic lost reply')); await expect(handoverApi.write(original)).rejects.toMatchObject({name:'HandoverUnconfirmedError'});
  const first=globalThis.fetch.mock.calls[0];expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
  resetWriteUncertaintyForTests({preserveStorage:true});configureV2ApiClient({getAccessToken:()=> 'SYNTHETIC-ROTATED-TOKEN',getFacilityCode:()=> 'HMS',canRefreshSession:()=>false});activate();
  for(const payload of [{...original.payload,client_request_id:ids[11]}, kind==='void'?{...original.payload,reason:'Different synthetic reason'}:{...original.payload,narrative:{...narrative,patient_condition:'Different synthetic condition'}}]) {
    await expect(handoverApi.write({...original,payload})).rejects.toMatchObject({data:{error:{code:'write_review_required'}}});
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
  }
  globalThis.fetch.mockResolvedValueOnce(json({data:{...receipt(original),replayed:true}}));await expect(handoverApi.write(original)).resolves.toMatchObject({replayed:true});
  expect(globalThis.fetch).toHaveBeenCalledTimes(2);expect(globalThis.fetch.mock.calls[1][0]).toBe(first[0]);expect(globalThis.fetch.mock.calls[1][1].body).toBe(first[1].body);expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
