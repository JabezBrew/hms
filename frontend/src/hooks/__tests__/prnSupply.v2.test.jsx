import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';
import { useDispenseMedication } from '../useNursingQueries';
import { getV2PendingPharmacyQueue } from '../nursingQueriesV2Bridge';
const oldFetch=globalThis.fetch;const oldConfig=window.__HMS_RUNTIME_CONFIG__;
const response=(data,page)=>new Response(JSON.stringify({data,page}),{status:200,headers:{'content-type':'application/json'}});
function wrap(client){return ({children})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;}
describe('PRN source fulfillment supply safety',()=>{
 beforeEach(()=>{window.__HMS_RUNTIME_CONFIG__={apiMode:'rust-v2',v2ApiBaseUrl:'http://localhost:8080/api/v2'};globalThis.fetch=vi.fn();__resetV2ApiClientForTests();configureV2ApiClient({getAccessToken:()=> 'synthetic',getFacilityCode:()=> 'HMS'});});
 afterEach(()=>{globalThis.fetch=oldFetch;window.__HMS_RUNTIME_CONFIG__=oldConfig;__resetV2ApiClientForTests();});
 it('includes partially supplied PRN fulfillments, follows cursors and preserves stock basis',async()=>{
  const signal=new AbortController().signal;globalThis.fetch.mockImplementation(async(url,options)=>{const query=new URL(url).searchParams;expect(query.has('status')).toBe(false);expect(query.get('patient_id')).toBe('selected-patient');expect(options.signal).toBe(signal);return query.has('cursor')?response([{id:'second',requested_dose_count:2,dispensed_dose_count:1,status:'partially_dispensed',prn_policy:{stock_units_per_dose:2,stock_unit:'tablet'}}],{has_next:false}):response([{id:'first'}],{has_next:true,next_cursor:'opaque'});});
  const rows=await getV2PendingPharmacyQueue({patientId:'selected-patient',signal});expect(rows).toHaveLength(2);expect(rows[1]).toMatchObject({id:'second',dose_count:1,prn_policy:{stock_units_per_dose:2,stock_unit:'tablet'}});
 });
 it('rejects a later queue page failure and repeated cursors without partial totals',async()=>{
  globalThis.fetch.mockResolvedValueOnce(response([{id:'first'}],{has_next:true,next_cursor:'opaque'})).mockRejectedValueOnce(new TypeError('Synthetic failed page'));
  await expect(getV2PendingPharmacyQueue()).rejects.toThrow('Synthetic failed page');globalThis.fetch.mockReset();globalThis.fetch.mockImplementation(async()=>response([{id:'first'}],{has_next:true,next_cursor:'repeat'}));await expect(getV2PendingPharmacyQueue()).rejects.toThrow('completely loaded');expect(globalThis.fetch).toHaveBeenCalledTimes(2);
 });
 it.each(['missing','wrong-id','wrong-count','negative-counts','generic409','network'])('does not claim confirmed supply or retry after %s response',async(kind)=>{
  globalThis.fetch.mockImplementation(async()=>{if(kind==='network')throw new TypeError('Synthetic lost supply response');if(kind==='generic409')return new Response(JSON.stringify({error:{code:'pharmacy_dispense_unconfirmed',message:'Could not confirm'}}),{status:409,headers:{'content-type':'application/json'}});return response(kind==='missing'?{}:{fulfillment:{inventory_item_id:'stock-one',frequency:'prn',prn_policy:{stock_unit:'tablet',stock_units_per_dose:2},id:kind==='wrong-id'?'another':'fulfillment-one',requested_dose_count:kind==='negative-counts'?-1:1,dispensed_dose_count:kind==='negative-counts'?-1:1},dispensed_dose_count:kind==='wrong-count'?0:1,remaining_dose_count:0,issued_stock_quantity:2,issued_stock_unit:'tablet'});});
  const client=new QueryClient({defaultOptions:{mutations:{retry:1,retryDelay:0}}});const {result}=renderHook(()=>useDispenseMedication(),{wrapper:wrap(client)});await act(async()=>{await expect(result.current.mutateAsync({fulfillmentId:'fulfillment-one',itemId:'stock-one',locationId:'location-one',quantity:1})).rejects.toMatchObject({name:'PharmacyDispenseUnconfirmedError'});});expect(globalThis.fetch).toHaveBeenCalledTimes(1);client.clear();
 });
 it('accepts a confirmed matching dose issue and rejects fractional dose quantities before POST',async()=>{
  globalThis.fetch.mockResolvedValue(response({fulfillment:{inventory_item_id:'stock-one',frequency:'prn',prn_policy:{stock_unit:'tablet',stock_units_per_dose:2},id:'fulfillment-one',requested_dose_count:1,dispensed_dose_count:1},dispensed_dose_count:1,remaining_dose_count:0,issued_stock_quantity:2,issued_stock_unit:'tablet'}));const client=new QueryClient();const {result}=renderHook(()=>useDispenseMedication(),{wrapper:wrap(client)});await act(async()=>{await result.current.mutateAsync({fulfillmentId:'fulfillment-one',itemId:'stock-one',locationId:'location-one',quantity:1});});await waitFor(()=>expect(result.current.isSuccess).toBe(true));await act(async()=>{await expect(result.current.mutateAsync({fulfillmentId:'fulfillment-one',itemId:'stock-one',locationId:'location-one',quantity:1.5})).rejects.toThrow('positive quantity');});expect(globalThis.fetch).toHaveBeenCalledTimes(1);client.clear();
 });
 it.each([0,undefined,true,'',-1,0.5])('never infers a one-dose supply from an invalid or absent explicit quantity (%j)',async(quantity)=>{
  const client=new QueryClient({defaultOptions:{mutations:{retry:false}}});const {result}=renderHook(()=>useDispenseMedication(),{wrapper:wrap(client)});await act(async()=>{await expect(result.current.mutateAsync({fulfillmentId:'fulfillment-one',itemId:'stock-one',locationId:'location-one',quantity})).rejects.toThrow('positive quantity');});expect(globalThis.fetch).not.toHaveBeenCalled();client.clear();
 });

});
