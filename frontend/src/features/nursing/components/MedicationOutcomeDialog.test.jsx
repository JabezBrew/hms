import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/client';
import { TreatmentSheetContent } from './TreatmentSheetContent';
import MedicationHistorySlideOver from '@/components/chronicle/MedicationHistorySlideOver';

const originalFetch=globalThis.fetch;const originalConfig=window.__HMS_RUNTIME_CONFIG__;
// jsdom lacks pointer capture used by the real shadcn/Radix select.
if (!HTMLElement.prototype.hasPointerCapture) HTMLElement.prototype.hasPointerCapture=()=>false;
if (!HTMLElement.prototype.setPointerCapture) HTMLElement.prototype.setPointerCapture=()=>{};
if (!HTMLElement.prototype.releasePointerCapture) HTMLElement.prototype.releasePointerCapture=()=>{};
if (!HTMLElement.prototype.scrollIntoView) HTMLElement.prototype.scrollIntoView=()=>{};
const response=(data,page)=>new Response(JSON.stringify({data,page}),{status:200,headers:{'content-type':'application/json'}});
const initialDose=()=>({id:'dose-one',prescription_id:'source-one',patient_id:'selected-patient',admission_case_id:'selected-admission',medication_name:'Synthetic medication',dose:'1 tablet',route:'oral',frequency:'daily',scheduled_at:`${new Date().toISOString().slice(0,10)}T00:00:00Z`,status:'scheduled',is_dispensed:true});
function renderGrid(client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:1,retryDelay:0}}})) {
  return {client,...render(<QueryClientProvider client={client}><MemoryRouter><TreatmentSheetContent admissionId="selected-admission" /></MemoryRouter></QueryClientProvider>)};
}
async function choose(user,label) { await user.click(screen.getByRole('combobox',{name:'Dose outcome'}));await user.click(screen.getByRole('option',{name:label})); }
describe('reachable Chronicle grid dose decisions',()=>{
  beforeEach(()=>{window.__HMS_RUNTIME_CONFIG__={apiMode:'rust-v2',v2ApiBaseUrl:'http://localhost:8080/api/v2'};globalThis.fetch=vi.fn();__resetV2ApiClientForTests();configureV2ApiClient({getAccessToken:()=> 'synthetic-token',getFacilityCode:()=> 'HMS'});});
  afterEach(()=>{globalThis.fetch=originalFetch;window.__HMS_RUNTIME_CONFIG__=originalConfig;__resetV2ApiClientForTests();});

  it('requires a reason and records Refused from the active grid without an administered claim',async()=>{
    let saved=initialDose();let writes=0;
    globalThis.fetch.mockImplementation(async(url,options)=>{
      if(options.method==='POST') { expect(url.endsWith('/dose-one/outcome')).toBe(true);writes+=1;const body=JSON.parse(options.body);expect(body.status).toBe('refused');expect(body.reason_not_given).toBe('Synthetic refusal');saved={...saved,...body,outcome_recorded_at:new Date().toISOString(),outcome_recorded_by_display_name:'Synthetic clinician'};return response(saved); }
      expect(new URL(url).searchParams.get('admission_case_id')).toBe('selected-admission');return response([saved],{has_next:false,next_cursor:null});
    });
    const user=userEvent.setup();const {client}=renderGrid();
    await user.click(await screen.findByRole('button',{name:/Record outcome: Synthetic medication/}));
    expect(writes).toBe(0);await choose(user,'Patient refused');expect(screen.getByRole('button',{name:'Record outcome'})).toBeDisabled();
    await user.type(screen.getByLabelText('Reason the dose was not given'),'Synthetic refusal');await user.click(screen.getByRole('button',{name:'Record outcome'}));
    await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());expect(writes).toBe(1);
    expect(await screen.findByRole('button',{name:/Refused: Synthetic medication/})).toBeDisabled();expect(screen.queryByText('Course progress')).not.toBeInTheDocument();expect(screen.getByText('Given in selected period')).toBeInTheDocument();expect(screen.getByText('All shown doses recorded')).toBeInTheDocument();client.clear();
  });

  it('offers a truthful nonadministration outcome when the source dose has no supply',async()=>{
    let saved={...initialDose(),is_dispensed:false};
    globalThis.fetch.mockImplementation(async(_url,options)=>{if(options.method==='POST'){saved={...saved,...JSON.parse(options.body),outcome_recorded_at:new Date().toISOString()};return response(saved);}return response([saved],{has_next:false,next_cursor:null});});
    const user=userEvent.setup();const {client}=renderGrid();await user.click(await screen.findByRole('button',{name:/Record outcome: Synthetic medication/}));expect(screen.getByText(/awaiting pharmacy supply/)).toBeInTheDocument();
    await user.click(screen.getByRole('combobox',{name:'Dose outcome'}));expect(screen.getByRole('option',{name:'Administered'})).toHaveAttribute('data-disabled');await user.click(screen.getByRole('option',{name:'Held'}));await user.type(screen.getByLabelText('Reason the dose was not given'),'Synthetic hold');await user.click(screen.getByRole('button',{name:'Record outcome'}));await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());expect(saved.status).toBe('held');expect(saved.is_dispensed).toBe(false);expect(saved.administered_at).toBeUndefined();client.clear();
  });

  it.each(['network','generic409'])('blocks another decision after a saved outcome followed by %s',async(kind)=>{
    let saved=initialDose();let writes=0;
    globalThis.fetch.mockImplementation(async(_url,options)=>{
      if(options.method==='POST'){writes+=1;saved={...saved,...JSON.parse(options.body),outcome_recorded_at:new Date().toISOString()};if(kind==='network')throw new TypeError('Synthetic lost response');return new Response(JSON.stringify({error:{code:'medication_outcome_unconfirmed',message:'Could not confirm'}}),{status:409,headers:{'content-type':'application/json'}});}
      return response([saved],{has_next:false,next_cursor:null});
    });
    const user=userEvent.setup();const {client}=renderGrid();await user.click(await screen.findByRole('button',{name:/Record outcome: Synthetic medication/}));await choose(user,'Patient refused');await user.type(screen.getByLabelText('Reason the dose was not given'),'Synthetic refusal');await user.click(screen.getByRole('button',{name:'Record outcome'}));expect(await screen.findByRole('alert')).toHaveTextContent('may have been saved');expect(screen.getByRole('button',{name:'Record outcome'})).toBeDisabled();expect(screen.getByRole('combobox',{name:'Dose outcome'})).toBeDisabled();await user.click(screen.getAllByRole('button',{name:'Close'}).at(-1));expect(await screen.findByRole('button',{name:/Refused: Synthetic medication/})).toBeDisabled();expect(writes).toBe(1);client.clear();
  });

  it('shows saved nonadministration reasons and recording evidence in history without a given timestamp',async()=>{
    globalThis.fetch.mockResolvedValue(response([{...initialDose(),status:'refused',reason_not_given:'Synthetic refusal',administration_notes:'Synthetic observation',outcome_recorded_at:'2026-10-15T08:00:00Z',outcome_recorded_by_display_name:'Synthetic clinician',administered_at:null}],{has_next:false,next_cursor:null}));
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});render(<QueryClientProvider client={client}><MedicationHistorySlideOver open patient={{id:'selected-patient',name:'Synthetic fixture'}} onClose={vi.fn()} /></QueryClientProvider>);
    expect(await screen.findByText('Reason: Synthetic refusal')).toBeInTheDocument();expect(screen.getByText('Notes: Synthetic observation')).toBeInTheDocument();expect(screen.getByText(/Recorded.*by Synthetic clinician/)).toBeInTheDocument();expect(screen.getByText('Refused')).toBeInTheDocument();client.clear();
  });

  it('drops the old dose decision when the active admission changes',async()=>{
    let writes=0;
    globalThis.fetch.mockImplementation(async(url,options)=>{
      if(options.method==='POST'){writes+=1;throw new Error('No old-context write is allowed');}
      const admission=new URL(url).searchParams.get('admission_case_id');
      return response([{...initialDose(),id:`dose-${admission}`,admission_case_id:admission,patient_id:`patient-${admission}`,medication_name:`Synthetic ${admission}`}],{has_next:false,next_cursor:null});
    });
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
    const tree=(admission)=><QueryClientProvider client={client}><MemoryRouter><TreatmentSheetContent admissionId={admission} /></MemoryRouter></QueryClientProvider>;
    const view=render(tree('admission-A'));const user=userEvent.setup();
    await user.click(await screen.findByRole('button',{name:/Record outcome: Synthetic admission-A/}));
    await choose(user,'Patient refused');await user.type(screen.getByLabelText('Reason the dose was not given'),'Synthetic reason');
    view.rerender(tree('admission-B'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByRole('button',{name:/Record outcome: Synthetic admission-B/})).toBeEnabled();
    expect(screen.queryByRole('button',{name:'Record outcome'})).not.toBeInTheDocument();expect(writes).toBe(0);client.clear();
  });
});
