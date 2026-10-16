import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';
import { PrnOrders } from './PrnOrders';
import { getPrnOrdersPage, requestPrnDose } from '../api/prn';

const oldFetch=globalThis.fetch;const oldConfig=window.__HMS_RUNTIME_CONFIG__;
const order=()=>({prescription_id:'source-one',patient_id:'patient-one',medication_name:'Synthetic PRN',dose:'2 tablets',route:'oral',prn_policy:{minimum_interval_hours:4,maximum_doses_per_24_hours:2,indication:'Synthetic prescribed indication',stock_units_per_dose:2,stock_unit:'tablet'},administered_in_last_24_hours:0,unavailable_reason:null});
const response=(data,page={has_next:false,next_cursor:null},status=200)=>new Response(JSON.stringify(status===200?{data,page}:data),{status,headers:{'content-type':'application/json'}});
const saved=(body)=>({...body,medication_administration_id:'dose-one',pharmacy_fulfillment_id:'fulfillment-one',created:true});
function view(admissionId='admission-one') { const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:1,retryDelay:0}}});return {client,...render(<QueryClientProvider client={client}><PrnOrders admissionId={admissionId}/></QueryClientProvider>)}; }
async function open(user){await user.click(await screen.findByRole('button',{name:'Request one dose'}));}

describe('source-linked as-needed dose workflow',()=>{
 beforeEach(()=>{window.__HMS_RUNTIME_CONFIG__={apiMode:'rust-v2',v2ApiBaseUrl:'http://localhost:8080/api/v2'};globalThis.fetch=vi.fn();__resetV2ApiClientForTests();configureV2ApiClient({getAccessToken:()=> 'synthetic-token',getFacilityCode:()=> 'HMS'});});
 afterEach(()=>{globalThis.fetch=oldFetch;window.__HMS_RUNTIME_CONFIG__=oldConfig;__resetV2ApiClientForTests();});
 it('requires actual indication, shows prescribed limits and creates only a pharmacy request',async()=>{
  let state=order();let writes=[];globalThis.fetch.mockImplementation(async(url,options)=>{if(options.method==='POST'){expect(url.endsWith('/nursing/prn-dose-requests')).toBe(true);const body=JSON.parse(options.body);writes.push(body);state={...state,unavailable_reason:'pending_dose',pending_medication_administration_id:'dose-one',pending_is_dispensed:false};return response(saved(body));}expect(new URL(url).searchParams.get('admission_case_id')).toBe('admission-one');return response([state]);});
  const user=userEvent.setup();const {client}=view();expect(await screen.findByText(/At least 4 hours apart/)).toHaveTextContent('2 tablet per dose');await open(user);expect(screen.getByRole('button',{name:'Request dose'})).toBeDisabled();await user.type(screen.getByLabelText('Why is this dose needed now?'),'Synthetic actual indication');await user.dblClick(screen.getByRole('button',{name:'Request dose'}));await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());expect(writes).toHaveLength(1);expect(writes[0]).toMatchObject({prescription_id:'source-one',admission_case_id:'admission-one',indication:'Synthetic actual indication'});expect(writes[0].client_request_id).toMatch(/^[0-9a-f-]{36}$/);expect(await screen.findByText(/Outstanding dose awaiting pharmacy/)).toBeInTheDocument();expect(screen.getByRole('button',{name:'Request one dose'})).toBeDisabled();client.clear();
 });
 it.each(['network','abort','generic409'])('locks a request after a saved write followed by %s and never retries automatically',async(kind)=>{
  let writes=0;let state=order();globalThis.fetch.mockImplementation(async(_url,options)=>{if(options.method==='POST'){writes+=1;state={...state,unavailable_reason:'pending_dose',pending_medication_administration_id:'dose-one',pending_is_dispensed:false};if(kind==='generic409')return response({error:{code:'prn_request_unconfirmed',message:'Could not confirm'}},null,409);if(kind==='abort')throw new DOMException('Synthetic abort','AbortError');throw new TypeError('Synthetic lost response');}return response([state]);});
  const user=userEvent.setup();const {client}=view();await open(user);await user.type(screen.getByLabelText('Why is this dose needed now?'),'Synthetic reason');await user.click(screen.getByRole('button',{name:'Request dose'}));expect(await screen.findByRole('alert')).toHaveTextContent('may have been saved');expect(screen.getByRole('button',{name:'Request dose'})).toBeDisabled();expect(screen.getByLabelText('Why is this dose needed now?')).toBeDisabled();expect(writes).toBe(1);client.clear();
 });
 it('blocks unconfigured legacy orders and server limit denials truthfully',async()=>{
  globalThis.fetch.mockImplementation(async()=>response([{...order(),prn_policy:null,unavailable_reason:'unconfigured'}]));const {client}=view();expect(await screen.findByText(/replace this order with explicit PRN limits/)).toBeInTheDocument();expect(screen.getByRole('button',{name:'Request one dose'})).toBeDisabled();client.clear();
 });
 it('discards a selected source and indication when admission changes',async()=>{
  globalThis.fetch.mockImplementation(async()=>response([order()]));const user=userEvent.setup();const {client,rerender}=view();await open(user);await user.type(screen.getByLabelText('Why is this dose needed now?'),'Old synthetic reason');rerender(<QueryClientProvider client={client}><PrnOrders admissionId="admission-two"/></QueryClientProvider>);expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(globalThis.fetch.mock.calls.filter(([,options])=>options.method==='POST')).toHaveLength(0);client.clear();
 });
 it('uses server cursors, retains AbortSignal and surfaces later page failures',async()=>{
  let page2=0;globalThis.fetch.mockImplementation(async(url,options)=>{expect(options.signal).toBeInstanceOf(AbortSignal);const cursor=new URL(url).searchParams.get('cursor');if(cursor){page2+=1;expect(cursor).toBe('opaque-cursor');return response({error:{message:'Synthetic unavailable'}},null,503);}return response([order()],{has_next:true,next_cursor:'opaque-cursor'});});
  const user=userEvent.setup();const {client}=view();await user.click(await screen.findByRole('button',{name:'Load more as-needed orders'}));expect(await screen.findByRole('alert')).toHaveTextContent('could not be fully refreshed');expect(screen.getByRole('button',{name:'Request one dose'})).toBeDisabled();expect(page2).toBe(1);client.clear();
 });
 it('rejects an unchanged continuation cursor instead of presenting a complete list',async()=>{
  globalThis.fetch.mockResolvedValue(response([order()],{has_next:true,next_cursor:'repeat'}));await expect(getPrnOrdersPage('admission-one','repeat')).rejects.toThrow('next page');
 });
 it('rejects an incomplete or wrong-source success as an uncertain write',async()=>{
  globalThis.fetch.mockResolvedValue(response({medication_administration_id:'dose-one',prescription_id:'different'}));await expect(requestPrnDose({prescription_id:'source-one',admission_case_id:'admission-one',client_request_id:'request-one',indication:'Synthetic'})).rejects.toMatchObject({name:'PrnRequestUnconfirmedError'});
 });
});
