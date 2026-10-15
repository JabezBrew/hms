import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureV2ApiClient, __resetV2ApiClientForTests, getV2ClientScopeKey } from '@/lib/api/v2/client';
import { useAdministerMedication } from '../useNursingQueries';
import { nursingKeys } from '../nursing/nursingQueryKeys';
import { buildMARGrid, normalizeV2MedicationAdministerPayload } from '../nursingQueriesV2Bridge';

const originalFetch=globalThis.fetch;
const originalConfig=window.__HMS_RUNTIME_CONFIG__;
const object=(data)=>new Response(JSON.stringify({data}),{status:200,headers:{'content-type':'application/json'}});
function wrapper(client) { return ({children})=><QueryClientProvider client={client}>{children}</QueryClientProvider>; }
describe('explicit Rust medication outcomes',()=>{
  beforeEach(()=>{window.__HMS_RUNTIME_CONFIG__={apiMode:'rust-v2',v2ApiBaseUrl:'http://localhost:8080/api/v2'}; globalThis.fetch=vi.fn();__resetV2ApiClientForTests();configureV2ApiClient({getAccessToken:()=> 'synthetic-token',getFacilityCode:()=> 'HMS'});});
  afterEach(()=>{globalThis.fetch=originalFetch;window.__HMS_RUNTIME_CONFIG__=originalConfig;__resetV2ApiClientForTests();});
  it.each(['missed','refused','held'])('sends %s and its reason to the explicit outcome route without converting it to administered',async(status)=>{
    globalThis.fetch.mockResolvedValueOnce(object({id:'dose-one',status,patient_id:'selected-patient',dose:'1 tablet',frequency:'q6h',reason_not_given:'Synthetic reason',outcome_recorded_at:'2026-10-15T08:00:00Z'}));
    const client=new QueryClient({defaultOptions:{mutations:{retry:1}}});const {result}=renderHook(()=>useAdministerMedication(),{wrapper:wrapper(client)});
    await act(async()=>{await result.current.mutateAsync({medicationId:'dose-one',data:{status,reason_not_given:' Synthetic reason ',administration_notes:'Synthetic note'}});});
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);expect(globalThis.fetch.mock.calls[0][0]).toBe('http://localhost:8080/api/v2/nursing/medication-administrations/dose-one/outcome');
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toEqual({status,witness_user_id:null,reason_not_given:'Synthetic reason',administration_notes:'Synthetic note'});
    await waitFor(()=>expect(result.current.data).toMatchObject({status,dosage:'1 tablet',frequency_display:'q6h',reason_not_given:'Synthetic reason'}));client.clear();
  });
  it('rejects unsupported decisions and blank reasons before a request',()=>{
    expect(()=>normalizeV2MedicationAdministerPayload({status:'cancelled',reason_not_given:'Synthetic'})).toThrow('supported');
    expect(()=>normalizeV2MedicationAdministerPayload({status:'refused',reason_not_given:'   '})).toThrow('reason');
    expect(()=>normalizeV2MedicationAdministerPayload({status:'held',reason_not_given:'é'.repeat(501)})).toThrow('long');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it.each(['network','generic409','5xx','wrong-status'])('treats persisted-then-%s as unconfirmed, never automatically retries and invalidates the actual MAR/history/supply keys',async(kind)=>{
    globalThis.fetch.mockImplementation(async()=>{
      if(kind==='network')throw new TypeError('Synthetic lost response');
      if(kind==='wrong-status')return object({id:'dose-one',status:'administered'});
      return new Response(JSON.stringify({error:{code:kind==='generic409'?'medication_outcome_unconfirmed':'unavailable',message:'Synthetic uncertain write'}}),{status:kind==='generic409'?409:503,headers:{'content-type':'application/json'}});
    });
    const client=new QueryClient({defaultOptions:{mutations:{retry:1,retryDelay:0}}});const scope=getV2ClientScopeKey();
    const keys=[nursingKeys.patientMar('selected-patient','2026-10-15',scope),nursingKeys.marGrid('selected-admission','2026-10-15',7,scope),nursingKeys.medicationAdministrationHistoryPage(scope,{patient_id:'selected-patient'},1),nursingKeys.pendingDispensingGrouped('selected-patient')];
    keys.forEach((key)=>client.setQueryData(key,{synthetic:true}));const unrelated=['patients','detail','selected-patient','demographics'];client.setQueryData(unrelated,{synthetic:true});
    const {result}=renderHook(()=>useAdministerMedication(),{wrapper:wrapper(client)});
    await act(async()=>{await expect(result.current.mutateAsync({medicationId:'dose-one',data:{status:'refused',reason_not_given:'Synthetic reason'}})).rejects.toMatchObject({name:'MedicationOutcomeUnconfirmedError'});});
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);expect(keys.every((key)=>client.getQueryState(key).isInvalidated)).toBe(true);expect(client.getQueryState(unrelated).isInvalidated).toBe(false);client.clear();
  });
  it('never claims a filtered week is the full prescription course or invents its duration',()=>{
    const grid=buildMARGrid([{id:'dose-one',prescription_id:'source-one',patient_id:'selected-patient',admission_case_id:'selected-admission',medication_name:'Synthetic',scheduled_time:'2026-10-15T08:00:00Z',status:'administered'}],'selected-admission','2026-10-15',7);
    expect(grid.medications[0]).toMatchObject({progress_scope:'selected_period',course_complete:false,period_complete:true,duration_days:null,total_doses_administered:1,total_doses_required:1});
  });
});
