import { webcrypto } from 'node:crypto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthContext } from '@/lib/auth/AuthContext';
import { ReadOnlyModeProvider } from '@/contexts/ReadOnlyModeContext';
import { __resetV2ApiClientForTests, configureV2ApiClient, getV2ClientScopeKey, v2Request } from '@/lib/api/v2/client';
import { bindNetworkAccessGuard } from '@/lib/api/v2/networkAccessGuard';
import { authorizationIdentity } from '@/shared/lib/authorizationScope';
import { activateWriteUncertainty, getWriteUncertaintySnapshot, resetWriteUncertaintyForTests } from '@/lib/api/v2/writeUncertainty';
import { WriteRecoveryNotice } from '@/features/settings/network/WriteRecoveryNotice';
import { inputDigest } from '../model';
import OrganizationDirectoryPage from '../OrganizationDirectoryPage';
import { actor, actorId, facilityId, unit, envelope, requestId, at } from './fixtures';
const runtime = window.__HMS_RUNTIME_CONFIG__, originalFetch = globalThis.fetch; let client, denyParent, reads, readOnly;
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto); __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' }; denyParent = false; reads = 0; readOnly = false;
  configureV2ApiClient({ getAccessToken: () => 'SYNTHETIC-ORG-ENTRY', getFacilityCode: () => 'QA', canRefreshSession: () => false }); const transport = getV2ClientScopeKey(), authority = authorizationIdentity(actor), principal = { id: actorId, facility_id: facilityId, active_profile: 'hospital' }; bindNetworkAccessGuard({ transportScope: transport, authorityScope: authority, principal }).update({ confirmed: true, decision: { access_allowed: true, read_only: readOnly, classification: 'onsite', policy_version: 1 } }); activateWriteUncertainty(principal, { authority, transport });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  globalThis.fetch = vi.fn(async () => { reads++; return new Response(JSON.stringify(denyParent ? { error: { code: 'forbidden' } } : envelope([unit])), { status: denyParent ? 403 : 200, headers: { 'content-type': 'application/json' } }); });
});
afterEach(async () => { cleanup(); await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); client.clear(); __resetV2ApiClientForTests(); vi.unstubAllGlobals(); globalThis.fetch = originalFetch; window.__HMS_RUNTIME_CONFIG__ = runtime; });
function mount() { render(<QueryClientProvider client={client}><AuthContext.Provider value={{ user: actor }}><ReadOnlyModeProvider network={{ confirmed: true, decision: { access_allowed: true, read_only: readOnly, classification: 'onsite', policy_version: 1 } }}><MemoryRouter><WriteRecoveryNotice /><OrganizationDirectoryPage /></MemoryRouter></ReadOnlyModeProvider></AuthContext.Provider></QueryClientProvider>); }
it.each([false, true])('actual independently keyed parent-list denial=%s controls protected draft lifetime', async denied => {
  mount(); await screen.findByText(unit.name); fireEvent.click(screen.getByRole('button', { name: 'Create unit' })); await screen.findByRole('radio', { name: new RegExp(unit.name) });
  fireEvent.change(screen.getByLabelText('Unit name'), { target: { value: 'Synthetic retained draft' } }); fireEvent.click(screen.getByRole('radio', { name: new RegExp(unit.name) }));
  denyParent = denied; await act(async () => { await client.invalidateQueries({ predicate: query => query.queryKey[3]?.purpose === 'parent-selection' }); });
  if (denied) { await screen.findByText('Organization administration unavailable'); expect(screen.queryByDisplayValue('Synthetic retained draft')).not.toBeInTheDocument(); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); }
  else { expect(screen.getByDisplayValue('Synthetic retained draft')).toBeInTheDocument(); expect(screen.getByRole('radio', { name: new RegExp(unit.name) })).toBeChecked(); }
  expect(reads).toBe(3); expect(fetch.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
});
it('reaches actual original receipt after reload in read-only mode and still requires separate acknowledgment', async () => {
  const payload = { client_request_id: requestId, expected_version: 1, name: 'Synthetic original renamed service' }, input = { action: 'rename', unit_id: unit.id, ...payload };
  fetch.mockRejectedValueOnce(new TypeError('Synthetic lost rename reply'));
  await expect(v2Request({ method: 'POST', path: '/api/v2/admin/org-units/{id}/rename', pathParams: { id: unit.id }, body: payload })).rejects.toMatchObject({ status: 0 });
  resetWriteUncertaintyForTests({ preserveStorage: true }); readOnly = true;
  const transport = getV2ClientScopeKey(), authority = authorizationIdentity(actor), principal = { id: actorId, facility_id: facilityId, active_profile: 'hospital' };
  bindNetworkAccessGuard({ transportScope: transport, authorityScope: authority, principal }).update({ confirmed: true, decision: { access_allowed: true, read_only: true, classification: 'onsite', policy_version: 1 } }); activateWriteUncertainty(principal, { authority, transport });
  const receipt = { client_request_id: requestId, input_digest: await inputDigest(input), reviewed_input: input, recorded_by_user_id: actorId, unit: { ...unit, name: payload.name, version: 2 }, changed: true, recorded_at: at };
  fetch.mockImplementation(async url => new Response(JSON.stringify(new URL(url).pathname.includes('/commands/') ? { data: receipt } : envelope([unit])), { headers: { 'content-type': 'application/json' } }));
  mount(); await screen.findByText(unit.name); expect(screen.getByRole('button', { name: 'Create unit' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'I reviewed the fresh workflow record' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Find original organization result' })); await screen.findByText(/Original action: rename/);
  expect(getWriteUncertaintySnapshot().entries).toHaveLength(1); expect(screen.queryByRole('button', { name: 'Retry unchanged reviewed change' })).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('button', { name: 'I reviewed the fresh workflow record' })).toBeEnabled()); fireEvent.click(screen.getByRole('button', { name: 'I reviewed the fresh workflow record' }));
  await waitFor(() => expect(getWriteUncertaintySnapshot().entries).toHaveLength(0)); expect(fetch.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1);
});

it.each([false,true])('actual retained original-receipt controller respects a later shared read denial=%s',async denied=>{
 let enter,release;const began=new Promise(resolve=>enter=resolve);let reviewed;
 fetch.mockImplementation(async(url,options)=>{const path=new URL(url).pathname;
 if(options.method==='POST'){const body=JSON.parse(options.body);reviewed={action:'rename',unit_id:unit.id,...body};throw new TypeError('Synthetic original reply loss');}
 if(path.includes('/commands/')){enter();return new Promise(resolve=>{release=async()=>resolve(new Response(JSON.stringify({data:{client_request_id:reviewed.client_request_id,input_digest:await inputDigest(reviewed),reviewed_input:reviewed,recorded_by_user_id:actorId,unit:{...unit,name:reviewed.name,version:2},changed:true,recorded_at:at}}),{headers:{'content-type':'application/json'}}));});}
 if(path.endsWith('/positions'))return new Response(JSON.stringify({error:{code:'forbidden'}}),{status:403,headers:{'content-type':'application/json'}});
 return new Response(JSON.stringify(path.endsWith('/'+unit.id)?{data:unit}:envelope([unit])),{headers:{'content-type':'application/json'}});});
 mount();await screen.findByText(unit.name);fireEvent.click(screen.getByRole('button',{name:'Rename '+unit.name}));fireEvent.change(screen.getByLabelText('Unit name'),{target:{value:'Synthetic retained command'}});fireEvent.click(screen.getByRole('button',{name:'Refresh and review change'}));fireEvent.click(await screen.findByLabelText('I reviewed this exact organization change'));fireEvent.click(screen.getByRole('button',{name:'Confirm reviewed change'}));await screen.findByText('Change needs reconciliation');expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
 fireEvent.click(screen.getByRole('button',{name:'Check original result'}));await began;
 if(denied)await expect(v2Request({path:'/api/v2/admin/positions'})).rejects.toMatchObject({status:403});
 await act(async()=>release());
 if(denied){await waitFor(()=>expect(screen.getByRole('button',{name:'Check original result'})).toBeEnabled());expect(screen.queryByText('Original change confirmed')).not.toBeInTheDocument();expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(false);
 const receipt={client_request_id:reviewed.client_request_id,input_digest:await inputDigest(reviewed),reviewed_input:reviewed,recorded_by_user_id:actorId,unit:{...unit,name:reviewed.name,version:2},changed:true,recorded_at:at};fetch.mockResolvedValueOnce(new Response(JSON.stringify({data:receipt}),{headers:{'content-type':'application/json'}}));fireEvent.click(screen.getByRole('button',{name:'Check original result'}));await screen.findByText('Original change confirmed');expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);}
 else{await screen.findByText('Original change confirmed');expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);}
});

it.each([false,true])('actual reload original read does not publish after newer denial=%s',async denied=>{
 const payload={client_request_id:requestId,expected_version:1,name:'Synthetic original renamed storage'},reviewed={action:'rename',unit_id:unit.id,...payload};fetch.mockRejectedValueOnce(new TypeError('Synthetic original loss'));await expect(v2Request({method:'POST',path:'/api/v2/admin/org-units/{id}/rename',pathParams:{id:unit.id},body:payload})).rejects.toMatchObject({status:0});resetWriteUncertaintyForTests({preserveStorage:true});readOnly=true;const transport=getV2ClientScopeKey(),authority=authorizationIdentity(actor),principal={id:actorId,facility_id:facilityId,active_profile:'hospital'};bindNetworkAccessGuard({transportScope:transport,authorityScope:authority,principal}).update({confirmed:true,decision:{access_allowed:true,read_only:true,classification:'onsite',policy_version:1}});activateWriteUncertainty(principal,{authority,transport});
 let enter,release;const began=new Promise(resolve=>enter=resolve),receipt={client_request_id:requestId,input_digest:await inputDigest(reviewed),reviewed_input:reviewed,recorded_by_user_id:actorId,unit:{...unit,name:payload.name,version:2},changed:true,recorded_at:at};
 fetch.mockImplementation(async url=>{const path=new URL(url).pathname;if(path.includes('/commands/')){enter();return new Promise(resolve=>{release=()=>resolve(new Response(JSON.stringify({data:receipt}),{headers:{'content-type':'application/json'}}));});}if(path.endsWith('/positions'))return new Response(JSON.stringify({error:{code:'forbidden'}}),{status:403,headers:{'content-type':'application/json'}});return new Response(JSON.stringify(envelope([unit])),{headers:{'content-type':'application/json'}});});
 mount();await screen.findByText(unit.name);fireEvent.click(screen.getByRole('button',{name:'Find original organization result'}));await began;if(denied)await expect(v2Request({path:'/api/v2/admin/positions'})).rejects.toMatchObject({status:403});await act(async()=>release());
 if(denied){await waitFor(()=>expect(screen.getByRole('button',{name:'Find original organization result'})).toBeEnabled());expect(screen.queryByText(/Original action: rename/)).not.toBeInTheDocument();expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(false);fetch.mockResolvedValueOnce(new Response(JSON.stringify({data:receipt}),{headers:{'content-type':'application/json'}}));fireEvent.click(screen.getByRole('button',{name:'Find original organization result'}));await screen.findByText(/Original action: rename/);expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(true);}
 else{await screen.findByText(/Original action: rename/);expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(true);}
 expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
});
