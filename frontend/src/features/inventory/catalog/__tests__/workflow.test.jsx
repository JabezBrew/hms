import { webcrypto } from 'node:crypto';
import { act, cleanup, fireEvent, render, screen, waitFor, } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthContext } from '@/lib/auth/AuthContext';
import { ReadOnlyModeProvider } from '@/contexts/ReadOnlyModeContext';
import { __resetV2ApiClientForTests, configureV2ApiClient, getV2ClientScopeKey, v2Request } from '@/lib/api/v2/client';
import { bindNetworkAccessGuard } from '@/lib/api/v2/networkAccessGuard';
import { activateWriteUncertainty, getWriteUncertaintySnapshot } from '@/lib/api/v2/writeUncertainty';
import { authorizationIdentity } from '@/shared/lib/authorizationScope';
import { networkApi } from '@/features/settings/network/api';
import { clockToken, clockNetwork } from '@/features/auth/__tests__/clock-fixtures';
import { inventoryCatalogApi } from '../api';
import InventoryCatalogPage from '../InventoryCatalogPage';
import { utcToday } from '../model';
import { actorId, categoryId, itemId, item, creation, page, makeResult } from './fixtures';
const runtime = window.__HMS_RUNTIME_CONFIG__;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
let user, current, client, decision, binding, token, detailMode, listMode, writeMode, pending, writes, receipts, categoryNext, transportFailures, receiptMode;
async function establish() {
 const principal = { id: user.id, facility_id: categoryId, active_profile: 'hospital' }, transport = getV2ClientScopeKey(), authority = authorizationIdentity(user);
 binding = bindNetworkAccessGuard({ transportScope: transport, authorityScope: authority, readOwnerValue: JSON.stringify(user), principal }); activateWriteUncertainty(principal, { authority, transport });
 decision = await networkApi.current(); binding.update({ confirmed: true, decision });
}
beforeEach(async () => {
 vi.stubGlobal('crypto', webcrypto); __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost/api/v2' };
 user = { id: actorId, role: 'inventory', facilityCode: 'HMS', adminAccess: { capabilities: ['inventory.view', 'inventory.manage', 'patient.demographics.view', 'system.deployment_capabilities.view'] }, accessContext: { facility_id: categoryId, active_profile: 'hospital', features: ['inventory'], patient_visibility: ['demographics'] } };
 transportFailures = [];
 const actualWrite = inventoryCatalogApi.write; vi.spyOn(inventoryCatalogApi, 'write').mockImplementation(async (...args) => { try { return await actualWrite(...args); } catch (error) { transportFailures.push({ name: error.name, status: error.status, code: error.data?.error?.code, cause: { name: error.cause?.name, message: error.cause?.message, status: error.cause?.status, code: error.cause?.data?.error?.code } }); throw error; } });
 token = clockToken(); current = structuredClone(item); receiptMode = detailMode = listMode = writeMode = 'ready'; pending = []; writes = []; receipts = new Map(); categoryNext = false;
 configureV2ApiClient({ getAccessToken: () => token.access_token, getFacilityCode: () => 'HMS', canRefreshSession: () => false });
 vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
  const path = new URL(url).pathname;
  if (path.endsWith('/auth/network-access')) return json({ data: clockNetwork() });
  if (options.method === 'POST') {
   const body = JSON.parse(options.body), action = path.endsWith('/catalog-edits') ? 'correct' : path.endsWith('/retire') ? 'retire' : path.endsWith('/reactivate') ? 'reactivate' : 'create'; writes.push({ path, body, signal: options.signal });
   if (writeMode === 'conflict') return json({ error: { code: 'inventory_item_version_conflict' } }, 409);
   const input = { action, ...(action === 'retire' || action === 'reactivate' ? { item_id: itemId } : {}), ...body };
   let receipt = receipts.get(body.client_request_id); if (!receipt) { receipt = (await makeResult(input, current, { today: utcToday() })).receipt; receipts.set(body.client_request_id, receipt); current = structuredClone(receipt.item); }
   if (writeMode === 'lost') throw new TypeError('Synthetic lost reply');
   if (writeMode === 'pending') return new Promise(resolve => pending.push(() => resolve(json({ data: receipt }))));
   return json({ data: receipt });
  }
  if (path.includes('/item-commands/')) { if (receiptMode === 'denied') return json({ error: { code: 'inventory_manage_denied' } }, 403); const receipt = receipts.get(path.split('/').at(-1)); return receipt ? json({ data: receipt }) : json({ error: { code: 'inventory_item_not_found' } }, 404); }
  if (path.endsWith('/categories')) { const next = new URL(url).searchParams.get('cursor'); return json({ data: [next ? { id: '24242424-0000-4000-8000-000000000029', code: 'SECOND', name: 'Synthetic category beyond first page' } : item.category], page: { limit: 25, has_next: categoryNext && !next, next_cursor: categoryNext && !next ? 'synthetic-category-cursor' : null }, meta: {} }); }
  if (path.endsWith('/catalog-history')) return json(page([]));
  if (path.endsWith('/items/administration')) {
   if (listMode === 'denied') return json({ error: { code: 'forbidden' } }, 403);
   if (listMode === 'failed') return json({ error: { code: 'synthetic_unavailable' } }, 503);
   return json(page([current]));
  }
  if (path.endsWith(`/${itemId}/administration`)) {
   if (detailMode === 'pending') return new Promise(resolve => pending.push(response => resolve(response ?? json({ data: { item: current, eligibility: { unit_change_blocked_by: null, lifecycle_blocked_by: null } } }))));
   if (detailMode === 'denied') return json({ error: { code: 'inventory_view_denied' } }, 403);
   return json({ data: { item: current, eligibility: { unit_change_blocked_by: null, lifecycle_blocked_by: null } } });
  }
  if (path.endsWith('/dashboard/snapshot')) return json({ error: { code: 'forbidden' } }, 403);
  return json({ error: { code: 'synthetic_not_found' } }, 404);
 }));
 await establish(); client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: 3 } } });
});
afterEach(async () => { cleanup(); client.clear(); __resetV2ApiClientForTests(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.__HMS_RUNTIME_CONFIG__ = runtime; });
function mount(path = '/inventory/catalog') {
 const tree = () => <QueryClientProvider client={client}><AuthContext.Provider value={{ user }}><ReadOnlyModeProvider network={{ confirmed: true, decision }}><MemoryRouter initialEntries={[path]}><Routes><Route path="/inventory/catalog/*" element={<InventoryCatalogPage />} /></Routes></MemoryRouter></ReadOnlyModeProvider></AuthContext.Provider></QueryClientProvider>;
 const view = render(tree()); return { ...view, update: () => view.rerender(tree()) };
}
async function openCorrection() { const ev = userEvent.setup(); await ev.click(await screen.findByRole('button', { name: 'Correct catalog details' })); fireEvent.change(screen.getByLabelText('Item name'), { target: { value: 'Synthetic reviewed correction' } }); fireEvent.change(screen.getByLabelText('Correction reason'), { target: { value: 'Synthetic exact label reason' } }); return ev; }
async function review(ev) { await ev.click(screen.getByRole('button', { name: 'Refresh and review catalog change' })); await ev.click(await screen.findByLabelText('I reviewed this exact catalog change')); }
it('browses and navigates an exact item with current actual transport, no mount write or legacy fields', async () => {
 mount(); const ev = userEvent.setup(); await ev.click(await screen.findByRole('button', { name: `View catalog details for ${item.name}` })); await screen.findByRole('heading', { name: 'Catalog recording history' }); expect(screen.getByText('Exact recorded stock unit')).toBeInTheDocument(); expect(writes).toHaveLength(0); expect(screen.queryByText(/unit price/i)).not.toBeInTheDocument();
});
it.each(['permission', 'feature', 'demographics', 'visibility'])('rejects missing %s even with an admin label before protected reads', missing => {
 user.role = 'admin'; if (missing === 'permission') user.adminAccess.capabilities = []; if (missing === 'feature') user.accessContext.features = []; if (missing === 'demographics') user.adminAccess.capabilities = ['inventory.view', 'inventory.manage']; if (missing === 'visibility') user.accessContext.patient_visibility = [];
 fetch.mockClear(); mount(); expect(screen.getByRole('heading', { name: 'Inventory catalog unavailable' })).toBeInTheDocument(); expect(fetch).not.toHaveBeenCalled();
});
it('preserves unchanged blank code and long raw unit in an actual separately confirmed UUID/CAS correction', async () => {
 current = { ...current, code: '', unit: '  ' + 'u'.repeat(121) + '  ' }; mount(`/inventory/catalog/${itemId}`); const ev = await openCorrection(); expect(screen.getByLabelText('Catalog code')).toHaveValue(''); await review(ev); expect(writes).toHaveLength(0);
 await ev.click(screen.getByRole('button', { name: 'Confirm reviewed catalog change' })); await waitFor(() => expect(screen.getByRole('dialog'), JSON.stringify({ writes: writes.length, transportFailures })).toHaveTextContent('Original catalog change confirmed'));  expect(writes).toHaveLength(1); expect(writes[0].body).toMatchObject({ client_request_id: expect.any(String), expected_version: 1, item_id: itemId, code: '', unit: '  ' + 'u'.repeat(121) + '  ', name: 'Synthetic reviewed correction' });
});
it('keeps exact unknown intent across close, route navigation and original-result reconciliation without another POST', async () => {
 mount(`/inventory/catalog/${itemId}`); const ev = await openCorrection(); await review(ev); writeMode = 'lost'; await ev.click(screen.getByRole('button', { name: 'Confirm reviewed catalog change' })); await screen.findByText('Catalog change needs reconciliation'); expect(writes).toHaveLength(1);
 await ev.click(screen.getByRole('button', { name: 'Close catalog review' })); await ev.click(screen.getByRole('button', { name: 'Back to catalog' })); await screen.findByRole('button', { name: `View catalog details for ${current.name}` }); await ev.click(screen.getByRole('button', { name: 'Review pending catalog change' }));
 await ev.click(screen.getByRole('button', { name: 'Check original catalog result' })); await waitFor(() => expect(screen.getByRole('dialog'), JSON.stringify({ writes: writes.length, transportFailures })).toHaveTextContent('Original catalog change confirmed'));  expect(writes).toHaveLength(1); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
it('keeps one actual request and locks dismissal while its POST is pending despite mutation retry defaults', async () => {
 mount(`/inventory/catalog/${itemId}`); const ev = await openCorrection(); await review(ev); writeMode = 'pending'; const submit = screen.getByRole('button', { name: 'Confirm reviewed catalog change' }); fireEvent.click(submit); fireEvent.click(submit); await waitFor(() => expect(pending).toHaveLength(1)); expect(writes).toHaveLength(1); expect(screen.getByRole('button', { name: 'Close catalog review' })).toBeDisabled(); await act(async () => pending[0]()); await waitFor(() => expect(screen.getByRole('dialog'), JSON.stringify({ writes: writes.length, transportFailures })).toHaveTextContent('Original catalog change confirmed'));
});
it('conceals exact cached detail and local draft after a genuine current403 invalidates its own lease', async () => {
 mount(`/inventory/catalog/${itemId}`); const ev = await openCorrection(); detailMode = 'denied'; await ev.click(screen.getByRole('button', { name: 'Refresh and review catalog change' })); await screen.findByRole('heading', { name: 'Inventory catalog unavailable' }); expect(screen.queryByDisplayValue('Synthetic reviewed correction')).not.toBeInTheDocument(); expect(writes).toHaveLength(0);
});
it('cancels only read preparation and rejects its late response after close and reopen', async () => {
 mount(`/inventory/catalog/${itemId}`); const ev = await openCorrection(); detailMode = 'pending'; fireEvent.click(screen.getByRole('button', { name: 'Refresh and review catalog change' })); await waitFor(() => expect(pending).toHaveLength(1)); const old = pending[0];
 const oldRequest = fetch.mock.calls.at(-1)[1]; await ev.click(screen.getByRole('button', { name: 'Close catalog review' })); expect(oldRequest.signal.aborted).toBe(true); await ev.click(screen.getByRole('button', { name: 'Correct catalog details' })); detailMode = 'ready'; await review(ev); await act(async () => old()); expect(screen.getByRole('heading', { name: 'Review exact catalog change' })).toBeVisible(); expect(writes).toHaveLength(0);
});
it('settles its own read busy state after unrelated actual403 without publishing stale review', async () => {
 mount(`/inventory/catalog/${itemId}`); await openCorrection(); detailMode = 'pending'; fireEvent.click(screen.getByRole('button', { name: 'Refresh and review catalog change' })); await waitFor(() => expect(pending).toHaveLength(1)); await act(async () => { await v2Request({ path: '/api/v2/dashboard/snapshot' }).catch(() => {}); pending[0](); });
 await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh and review catalog change' })).toBeEnabled()); expect(screen.queryByRole('heading', { name: 'Review exact catalog change' })).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Close catalog review' })).toBeEnabled(); expect(writes).toHaveLength(0);
});
it('clears review consent on a same-version/same-clock actual source refresh', async () => {
 mount(`/inventory/catalog/${itemId}`); const ev = await openCorrection(); await review(ev); await act(async () => client.invalidateQueries()); await waitFor(() => expect(screen.queryByLabelText('I reviewed this exact catalog change')).not.toBeInTheDocument()); expect(writes).toHaveLength(0);
});
it('does not revive cached rows after403 then500; explicit fresh200 is required', async () => {
 mount(); await screen.findByRole('button', { name: `View catalog details for ${item.name}` }); listMode = 'denied'; fireEvent.click(screen.getByRole('button', { name: 'Refresh catalog' })); await screen.findByRole('heading', { name: 'Inventory catalog unavailable' }); listMode = 'failed'; fireEvent.click(screen.getByRole('button', { name: 'Retry' })); await screen.findByRole('heading', { name: 'Catalog could not be loaded' }); expect(screen.queryByRole('button', { name: `View catalog details for ${item.name}` })).not.toBeInTheDocument();
});
it('requires explicit category across actual cursor pages, classification and exact raw unit for creation', async () => {
 categoryNext = true; mount(); const ev = userEvent.setup(); await ev.click(await screen.findByRole('button', { name: 'Add catalog item' })); fireEvent.change(screen.getByLabelText('Catalog code'), { target: { value: creation.code } }); fireEvent.change(screen.getByLabelText('Item name'), { target: { value: creation.name } }); fireEvent.change(screen.getByLabelText('Stock unit'), { target: { value: creation.unit } });
 fireEvent.keyDown(screen.getByRole('combobox', { name: 'Classification' }), { key: 'ArrowDown' }); await ev.click(await screen.findByRole('option', { name: 'Medication' })); await ev.click(await screen.findByRole('button', { name: 'Next category page' })); await ev.click(await screen.findByRole('button', { name: 'Synthetic category beyond first page (SECOND)' })); await review(ev); expect(writes).toHaveLength(0); await ev.click(screen.getByRole('button', { name: 'Confirm reviewed catalog change' })); await waitFor(() => expect(screen.getByRole('dialog'), JSON.stringify({ writes: writes.length, transportFailures })).toHaveTextContent('Original catalog change confirmed'));  expect(writes[0].body).toMatchObject({ category_id: '24242424-0000-4000-8000-000000000029', item_type: 'medication', unit: creation.unit });
});

it('a genuine current original-receipt403 conceals retained unknown fields even after invalidating its own network clock', async () => {
 mount(`/inventory/catalog/${itemId}`); const ev = await openCorrection(); await review(ev); writeMode = 'lost'; await ev.click(screen.getByRole('button', { name: 'Confirm reviewed catalog change' })); await screen.findByText('Catalog change needs reconciliation'); receiptMode = 'denied'; await ev.click(screen.getByRole('button', { name: 'Check original catalog result' })); await screen.findByRole('heading', { name: 'Inventory catalog unavailable' }); expect(screen.queryByText('Catalog change needs reconciliation')).not.toBeInTheDocument(); expect(writes).toHaveLength(1); expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
});

it.each(['actor', 'facility', 'profile', 'permission', 'feature', 'visibility'])('committed %s A→B→A drops unsent private intent and rejects the old actual403', async kind => {
 const view = mount(`/inventory/catalog/${itemId}`), ev = await openCorrection(); detailMode = 'pending'; fireEvent.click(screen.getByRole('button', { name: 'Refresh and review catalog change' })); await waitFor(() => expect(pending).toHaveLength(1)); const old = pending[0], original = structuredClone(user);
 if (kind === 'actor') user = { ...user, id: '24242424-0000-4000-8000-000000000039' };
 if (kind === 'facility') user = { ...user, facilityCode: 'OTHER', accessContext: { ...user.accessContext, facility_id: '24242424-0000-4000-8000-000000000039' } };
 if (kind === 'profile') user = { ...user, accessContext: { ...user.accessContext, active_profile: 'other' } };
 if (kind === 'permission') user = { ...user, adminAccess: { capabilities: [] } };
 if (kind === 'feature') user = { ...user, accessContext: { ...user.accessContext, features: [] } };
 if (kind === 'visibility') user = { ...user, accessContext: { ...user.accessContext, patient_visibility: [] } };
 detailMode = 'ready'; await act(async () => { await establish(); view.update(); }); await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
 user = original; await act(async () => { await establish(); view.update(); }); await screen.findByRole('button', { name: 'Correct catalog details' }); await ev.click(screen.getByRole('button', { name: 'Correct catalog details' })); expect(screen.getByLabelText('Item name')).toHaveValue(item.name);
 await act(async () => old(json({ error: { code: 'synthetic_old_ABA_denial' } }, 403))); expect(screen.queryByRole('heading', { name: 'Inventory catalog unavailable' })).not.toBeInTheDocument(); expect(screen.getByLabelText('Item name')).toHaveValue(item.name); expect(writes).toHaveLength(0);
});
