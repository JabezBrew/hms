import { webcrypto } from 'node:crypto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthContext } from '@/lib/auth/AuthContext';
import { ReadOnlyModeProvider } from '@/contexts/ReadOnlyModeContext';
import { __resetV2ApiClientForTests, configureV2ApiClient, getV2ClientScopeKey, v2Request } from '@/lib/api/v2/client';
import { bindNetworkAccessGuard, networkClockCurrent } from '@/lib/api/v2/networkAccessGuard';
import { activateWriteUncertainty, getWriteUncertaintySnapshot } from '@/lib/api/v2/writeUncertainty';
import { authorizationIdentity } from '@/shared/lib/authorizationScope';
import { networkApi } from '@/features/settings/network/api';
import { clockToken, clockNetwork } from '@/features/auth/__tests__/clock-fixtures';
import InventorySupplierPage from '../InventorySupplierPage';
import { actorId, supplierId, otherId, supplier, creation, detail, listItem, page, makeResult } from './fixtures';
const runtime = window.__HMS_RUNTIME_CONFIG__;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const reply = data => json({ data, meta: {} });
let user, current, client, decision, binding, token, detailMode, listMode, directoryPages, writeMode, pending, writes, receipts, receiptMode, blocker;
async function establish() {
  const principal = { id: user.id, facility_id: otherId, active_profile: 'hospital' }, transport = getV2ClientScopeKey(), authority = authorizationIdentity(user);
  binding = bindNetworkAccessGuard({ transportScope: transport, authorityScope: authority, readOwnerValue: JSON.stringify(user), principal }); activateWriteUncertainty(principal, { authority, transport });
  decision = await networkApi.current(); binding.update({ confirmed: true, decision });
}
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost/api/v2' };
  user = { id: actorId, role: 'ordinary', facilityCode: 'HMS', adminAccess: { capabilities: ['inventory.view', 'inventory.manage', 'patient.demographics.view', 'system.deployment_capabilities.view'] }, accessContext: { facility_id: otherId, active_profile: 'hospital', features: ['inventory'], patient_visibility: ['demographics'] } };
  token = clockToken(); current = structuredClone(supplier); receiptMode = detailMode = listMode = writeMode = 'ready'; pending = []; writes = []; receipts = new Map(); directoryPages = 1; blocker = null;
  configureV2ApiClient({ getAccessToken: () => token.access_token, getFacilityCode: () => 'HMS', canRefreshSession: () => false });
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    const address = new URL(url), path = address.pathname;
    if (path.endsWith('/auth/network-access')) return reply(clockNetwork());
    if (options.method === 'POST') {
      const body = JSON.parse(options.body), action = path.endsWith('/corrections') ? 'correct' : path.endsWith('/retire') ? 'retire' : path.endsWith('/reactivate') ? 'reactivate' : 'create'; writes.push({ path, body, signal: options.signal });
      if (writeMode === 'conflict') return json({ error: { code: 'inventory_supplier_version_conflict' } }, 409);
      const input = { action, ...(action !== 'create' ? { supplier_id: supplierId } : {}), ...body };
      let receipt = receipts.get(body.client_request_id); if (!receipt) { receipt = (await makeResult(input, current)).receipt; receipts.set(body.client_request_id, receipt); current = structuredClone(receipt.supplier); }
      if (writeMode === 'lost') throw new TypeError('Synthetic lost reply');
      if (writeMode === 'pending') return new Promise(resolve => pending.push(() => resolve(reply(receipt))));
      return reply(receipt);
    }
    if (path.includes('/supplier-commands/')) { if (receiptMode === 'denied') return json({ error: { code: 'authority_required' } }, 403); const receipt = receipts.get(path.split('/').at(-1)); return receipt ? reply(receipt) : json({ error: { code: 'inventory_supplier_not_found' } }, 404); }
    if (path.endsWith('/supplier-administration')) {
      if (listMode === 'denied') return json({ error: { code: 'forbidden' } }, 403);
      if (listMode === 'failed') return json({ error: { code: 'inventory_supplier_read_failed' } }, 500);
      if (directoryPages > 1) {
        const offset = Number((address.searchParams.get('cursor') ?? 'dir-0').slice(4));
        const rows = Array.from({ length: 25 }, (_, index) => ({ ...current, id: `26262626-0000-4000-8000-${String(offset + index + 100).padStart(12, '0')}`, name: `Synthetic directory supplier ${offset + index}` }));
        return json({ ...page(rows.map(listItem)), page: { limit: 25, has_next: offset + 25 < directoryPages * 25, next_cursor: offset + 25 < directoryPages * 25 ? `dir-${offset + 25}` : null } });
      }
      return json(page([listItem(current)]));
    }
    if (path.endsWith('/history')) return json(page([]));
    if (path.endsWith(`/${supplierId}/administration`)) {
      if (detailMode === 'pending') return new Promise(resolve => pending.push(response => resolve(response ?? reply(detail(current)))));
      if (detailMode === 'denied') return json({ error: { code: 'forbidden' } }, 403);
      return reply({ ...detail(current), eligibility: { ...detail(current).eligibility, lifecycle_blocked_by: blocker } });
    }
    if (path.endsWith('/dashboard/snapshot')) return json({ error: { code: 'forbidden' } }, 403);
    return json({ error: { code: 'synthetic_not_found' } }, 404);
  }));
  await establish(); client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: 3 } } });
});
afterEach(() => { cleanup(); client.clear(); __resetV2ApiClientForTests(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.__HMS_RUNTIME_CONFIG__ = runtime; });
function mount(path = '/inventory/suppliers') {
  const tree = () => <QueryClientProvider client={client}><AuthContext.Provider value={{ user }}><ReadOnlyModeProvider network={{ confirmed: true, decision }}><MemoryRouter initialEntries={[path]}><Routes><Route path="/inventory/suppliers/*" element={<InventorySupplierPage />} /></Routes></MemoryRouter></ReadOnlyModeProvider></AuthContext.Provider></QueryClientProvider>;
  const view = render(tree()); return { ...view, update: () => view.rerender(tree()) };
}
async function openCorrection() { const ev = userEvent.setup(); await ev.click(await screen.findByRole('button', { name: 'Correct supplier details' })); fireEvent.change(screen.getByLabelText('Supplier name'), { target: { value: 'Synthetic reviewed correction' } }); fireEvent.change(screen.getByLabelText('Correction reason'), { target: { value: 'Synthetic exact reason' } }); return ev; }
async function review(ev) { await ev.click(screen.getByRole('button', { name: 'Refresh and review supplier change' })); await ev.click(await screen.findByLabelText('I reviewed this exact supplier change')); }
async function select(ev, label, option) { fireEvent.keyDown(screen.getByRole('combobox', { name: label }), { key: 'ArrowDown' }); await ev.click(await screen.findByRole('option', { name: option })); }
it.each(['footer', 'close icon', 'Escape'])('restores focus to the current supplier opener after unsent %s dismissal', async method => {
  mount(`/inventory/suppliers/${supplierId}`); const ev = userEvent.setup(), opener = await screen.findByRole('button', { name: 'Correct supplier details' }); await ev.click(opener); await screen.findByRole('dialog');
  if (method === 'footer') await ev.click(screen.getByRole('button', { name: 'Close supplier review' }));
  else if (method === 'close icon') await ev.click(screen.getByRole('button', { name: 'Close', exact: true }));
  else await ev.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); await waitFor(() => expect(opener).toHaveFocus()); expect(writes).toHaveLength(0);
});
it('restores focus to a current page action after a confirmed supplier finish replaces the original opener', async () => {
  mount(`/inventory/suppliers/${supplierId}`); const opener = await screen.findByRole('button', { name: 'Correct supplier details' }), ev = await openCorrection(); await review(ev); await ev.click(screen.getByRole('button', { name: 'Confirm reviewed supplier change' })); await screen.findByText('Original supplier change confirmed');
  await waitFor(() => expect(opener.isConnected).toBe(false)); await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh suppliers and finish review' })).toBeEnabled()); await ev.click(screen.getByRole('button', { name: 'Refresh suppliers and finish review' })); await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); await waitFor(() => expect(screen.getByRole('button', { name: 'Back to suppliers' })).toHaveFocus()); expect(writes).toHaveLength(1);
});
it.each(['denial', 'scope change', 'scope ABA', 'unmount'])('does not restore supplier focus to an old opener after %s', async transition => {
  const view = mount(`/inventory/suppliers/${supplierId}`), opener = await screen.findByRole('button', { name: 'Correct supplier details' }), ev = await openCorrection(), original = structuredClone(user), focus = vi.spyOn(opener, 'focus'), allFocus = vi.spyOn(HTMLElement.prototype, 'focus');
  if (transition === 'denial') { detailMode = 'denied'; await ev.click(screen.getByRole('button', { name: 'Refresh and review supplier change' })); await screen.findByRole('heading', { name: 'Inventory suppliers unavailable' }); }
  else if (transition.startsWith('scope')) { user = { ...user, id: '26262626-0000-4000-8000-000000000039' }; await act(async () => { await establish(); view.update(); }); await screen.findByRole('button', { name: 'Correct supplier details' }); if (transition === 'scope ABA') { user = original; await act(async () => { await establish(); view.update(); }); await screen.findByRole('button', { name: 'Correct supplier details' }); } }
  else view.unmount();
  await waitFor(() => expect(opener.isConnected).toBe(false)); await act(async () => new Promise(resolve => setTimeout(resolve, 0))); expect(focus).not.toHaveBeenCalled(); if (transition.startsWith('scope')) { expect(allFocus.mock.instances).not.toContain(screen.getByRole('button', { name: 'Correct supplier details' })); expect(allFocus.mock.instances).not.toContain(screen.getByRole('button', { name: 'Back to suppliers' })); } expect(writes).toHaveLength(0);
});
it('browses exact supplier metadata/history with actual transport, without a mount write or legacy stock fields', async () => {
  mount(); const ev = userEvent.setup(); await ev.click(await screen.findByRole('button', { name: `View supplier details for ${supplier.name}` })); await screen.findByRole('heading', { name: 'Supplier recording history' }); expect(screen.getByText('Supplier reference')).toBeInTheDocument(); expect(writes).toHaveLength(0); expect(screen.queryByText(/unit price/i)).not.toBeInTheDocument();
});
it('browses beyond100 records with bounded server cursor pages and resets cursor after explicit search or status change', async () => {
  directoryPages = 5; mount(); const ev = userEvent.setup(); await screen.findByRole('button', { name: 'View supplier details for Synthetic directory supplier 0' });
  for (let index = 1; index <= 4; index++) { await ev.click(screen.getByRole('button', { name: 'Next' })); await screen.findByRole('button', { name: `View supplier details for Synthetic directory supplier ${index * 25}` }); }
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled(); expect(fetch.mock.calls.filter(([url]) => new URL(url).pathname.endsWith('/supplier-administration'))).toHaveLength(5);
  fireEvent.change(screen.getByLabelText('Find a supplier by name or code'), { target: { value: 'Synthetic literal search' } }); await ev.click(screen.getByRole('button', { name: 'Search suppliers' })); await screen.findByRole('button', { name: 'View supplier details for Synthetic directory supplier 0' });
  let url = new URL(fetch.mock.calls.at(-1)[0]); expect(url.searchParams.get('search')).toBe('Synthetic literal search'); expect(url.searchParams.has('cursor')).toBe(false);
  await select(ev, 'Status', 'Retired'); await waitFor(() => expect(new URL(fetch.mock.calls.at(-1)[0]).searchParams.get('is_active')).toBe('false')); url = new URL(fetch.mock.calls.at(-1)[0]); expect(url.searchParams.has('cursor')).toBe(false); expect(writes).toHaveLength(0);
});
it('fresh lifecycle review rechecks retained references and performs an unused retirement with its exact UUID/CAS only', async () => {
  mount(`/inventory/suppliers/${supplierId}`); const ev = userEvent.setup(); await ev.click(await screen.findByRole('button', { name: 'Review supplier retirement' })); blocker = 'item_reference'; await ev.click(screen.getByRole('button', { name: 'Refresh and review supplier change' })); expect(await screen.findByText(/retained item reference blocks/i)).toBeInTheDocument(); expect(writes).toHaveLength(0);
  blocker = null; await review(ev); await ev.click(screen.getByRole('button', { name: 'Confirm reviewed supplier change' })); await screen.findByText('Original supplier change confirmed'); expect(writes[0].path).toBe(`/api/v2/inventory/suppliers/${supplierId}/retire`); expect(writes[0].body).toEqual({ client_request_id: expect.any(String), expected_version: 1 });
});
it.each(['permission', 'feature', 'demographics', 'visibility', 'deployment'])('rejects missing %s even with an admin label before protected reads', missing => {
  user.role = 'admin'; if (missing === 'permission') user.adminAccess.capabilities = []; if (missing === 'feature') user.accessContext.features = []; if (missing === 'demographics') user.adminAccess.capabilities = ['inventory.view', 'inventory.manage', 'system.deployment_capabilities.view']; if (missing === 'visibility') user.accessContext.patient_visibility = []; if (missing === 'deployment') user.adminAccess.capabilities = user.adminAccess.capabilities.filter(value => value !== 'system.deployment_capabilities.view');
  fetch.mockClear(); mount(); expect(screen.getByRole('heading', { name: 'Inventory suppliers unavailable' })).toBeInTheDocument(); expect(fetch).not.toHaveBeenCalled();
});
it('keeps view-only suppliers readable and hides manager controls and original-receipt discovery', async () => {
  user.adminAccess.capabilities = user.adminAccess.capabilities.filter(value => value !== 'inventory.manage'); await establish(); mount(`/inventory/suppliers/${supplierId}`); await screen.findByRole('heading', { name: 'Supplier recording history' }); expect(screen.queryByRole('button', { name: 'Correct supplier details' })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Add supplier' })).not.toBeInTheDocument(); expect(writes).toHaveLength(0);
});
it('retains one exact unknown request across close and navigation, then confirms the original result without another POST', async () => {
  mount(`/inventory/suppliers/${supplierId}`); const ev = await openCorrection(); await review(ev); writeMode = 'lost'; await ev.click(screen.getByRole('button', { name: 'Confirm reviewed supplier change' })); await screen.findByText('Supplier change needs reconciliation'); expect(writes).toHaveLength(1);
  await ev.click(screen.getByRole('button', { name: 'Close supplier review' })); await ev.click(screen.getByRole('button', { name: 'Back to suppliers' })); await screen.findByRole('button', { name: `View supplier details for ${current.name}` }); await ev.click(screen.getByRole('button', { name: 'Review pending supplier change' })); await ev.click(screen.getByRole('button', { name: 'Check original supplier result' })); await screen.findByText('Original supplier change confirmed'); expect(writes).toHaveLength(1); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
it('keeps one synchronous write latch and locks dismissal while the actual POST runs despite mutation retry defaults', async () => {
  mount(`/inventory/suppliers/${supplierId}`); const ev = await openCorrection(); await review(ev); writeMode = 'pending'; const submit = screen.getByRole('button', { name: 'Confirm reviewed supplier change' }); fireEvent.click(submit); fireEvent.click(submit); await waitFor(() => expect(pending).toHaveLength(1)); expect(writes).toHaveLength(1); expect(screen.getByRole('button', { name: 'Close supplier review' })).toBeDisabled(); await act(async () => pending[0]()); await screen.findByText('Original supplier change confirmed');
});
it('cancels only read preparation and rejects a late result after close/reopen', async () => {
  mount(`/inventory/suppliers/${supplierId}`); const ev = await openCorrection(); detailMode = 'pending'; fireEvent.click(screen.getByRole('button', { name: 'Refresh and review supplier change' })); await waitFor(() => expect(pending).toHaveLength(1)); const old = pending[0], oldRequest = fetch.mock.calls.at(-1)[1]; await ev.click(screen.getByRole('button', { name: 'Close supplier review' })); expect(oldRequest.signal.aborted).toBe(true);
  await ev.click(screen.getByRole('button', { name: 'Correct supplier details' })); detailMode = 'ready'; await review(ev); await act(async () => old()); expect(screen.getByRole('heading', { name: 'Review exact supplier change' })).toBeVisible(); expect(writes).toHaveLength(0);
});
it('clears consent on same-version/same-clock actual source refresh', async () => {
  mount(`/inventory/suppliers/${supplierId}`); const ev = await openCorrection(); await review(ev); await act(async () => client.invalidateQueries()); await waitFor(() => expect(screen.queryByLabelText('I reviewed this exact supplier change')).not.toBeInTheDocument()); expect(writes).toHaveLength(0);
});
it('genuine current403 conceals cached detail and private draft even after invalidating its own clock', async () => {
  mount(`/inventory/suppliers/${supplierId}`); const ev = await openCorrection(); detailMode = 'denied'; await ev.click(screen.getByRole('button', { name: 'Refresh and review supplier change' })); await screen.findByRole('heading', { name: 'Inventory suppliers unavailable' }); expect(screen.queryByDisplayValue('Synthetic reviewed correction')).not.toBeInTheDocument(); expect(writes).toHaveLength(0);
});
it('keeps cached rows hidden after403 then500 until an explicit fresh200', async () => {
  const view = mount(); await screen.findByRole('button', { name: `View supplier details for ${supplier.name}` }); listMode = 'denied'; fireEvent.click(screen.getByRole('button', { name: 'Refresh suppliers' })); await screen.findByRole('heading', { name: 'Inventory suppliers unavailable' }); listMode = 'failed'; expect(networkClockCurrent(decision)).toBe(false); await act(async () => { await establish(); view.update(); }); expect(networkClockCurrent(decision)).toBe(true); fireEvent.click(screen.getByRole('button', { name: 'Retry' })); await screen.findByRole('heading', { name: 'Supplier could not be loaded' }); expect(screen.queryByRole('button', { name: `View supplier details for ${supplier.name}` })).not.toBeInTheDocument();
  listMode = 'ready'; fireEvent.click(screen.getByRole('button', { name: 'Retry' })); await screen.findByRole('button', { name: `View supplier details for ${supplier.name}` });
});
it('genuine original receipt403 conceals retained unknown fields while retaining opaque uncertainty', async () => {
  mount(`/inventory/suppliers/${supplierId}`); const ev = await openCorrection(); await review(ev); writeMode = 'lost'; await ev.click(screen.getByRole('button', { name: 'Confirm reviewed supplier change' })); await screen.findByText('Supplier change needs reconciliation'); receiptMode = 'denied'; await ev.click(screen.getByRole('button', { name: 'Check original supplier result' })); await screen.findByRole('heading', { name: 'Inventory suppliers unavailable' }); expect(screen.queryByText('Supplier change needs reconciliation')).not.toBeInTheDocument(); expect(getWriteUncertaintySnapshot().entries).toHaveLength(1); expect(writes).toHaveLength(1);
});
it.each(['actor', 'facility', 'profile', 'permission', 'feature', 'visibility'])('committed %s A→B→A removes unsent intent and rejects an old actual403', async kind => {
  const view = mount(`/inventory/suppliers/${supplierId}`), ev = await openCorrection(); detailMode = 'pending'; fireEvent.click(screen.getByRole('button', { name: 'Refresh and review supplier change' })); await waitFor(() => expect(pending).toHaveLength(1)); const old = pending[0], original = structuredClone(user);
  if (kind === 'actor') user = { ...user, id: '26262626-0000-4000-8000-000000000039' };
  if (kind === 'facility') user = { ...user, facilityCode: 'OTHER', accessContext: { ...user.accessContext, facility_id: '26262626-0000-4000-8000-000000000039' } };
  if (kind === 'profile') user = { ...user, accessContext: { ...user.accessContext, active_profile: 'other' } };
  if (kind === 'permission') user = { ...user, adminAccess: { capabilities: [] } };
  if (kind === 'feature') user = { ...user, accessContext: { ...user.accessContext, features: [] } };
  if (kind === 'visibility') user = { ...user, accessContext: { ...user.accessContext, patient_visibility: [] } };
  detailMode = 'ready'; await act(async () => { await establish(); view.update(); }); await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  user = original; await act(async () => { await establish(); view.update(); }); await screen.findByRole('button', { name: 'Correct supplier details' }); await ev.click(screen.getByRole('button', { name: 'Correct supplier details' })); expect(screen.getByLabelText('Supplier name')).toHaveValue(supplier.name);
  await act(async () => old(json({ error: { code: 'synthetic_old_ABA_denial' } }, 403))); expect(screen.queryByRole('heading', { name: 'Inventory suppliers unavailable' })).not.toBeInTheDocument(); expect(screen.getByLabelText('Supplier name')).toHaveValue(supplier.name); expect(writes).toHaveLength(0);
});
it('settles preparation after an unrelated current403 without publishing stale review', async () => {
  const view = mount(`/inventory/suppliers/${supplierId}`); await openCorrection(); const originalClock = decision, reasonInput = screen.getByLabelText('Correction reason'); detailMode = 'pending'; fireEvent.click(screen.getByRole('button', { name: 'Refresh and review supplier change' })); await waitFor(() => expect(pending).toHaveLength(1)); await act(async () => { await v2Request({ path: '/api/v2/dashboard/snapshot' }).catch(() => {}); pending[0](); });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh and review supplier change' })).toBeDisabled());
  expect(screen.queryByRole('button', { name: 'Confirming current supplier…' })).not.toBeInTheDocument();
  expect(networkClockCurrent(originalClock)).toBe(false);
  expect(screen.queryByRole('heading', { name: 'Review exact supplier change' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('I reviewed this exact supplier change')).not.toBeInTheDocument();
  expect(writes).toHaveLength(0);
  detailMode = 'ready'; await act(async () => { await establish(); view.update(); });
  expect(networkClockCurrent(decision)).toBe(true); expect(networkClockCurrent(originalClock)).toBe(false);
  expect(screen.getByLabelText('Correction reason')).toBe(reasonInput);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh and review supplier change' })).toBeEnabled()); expect(screen.queryByRole('heading', { name: 'Review exact supplier change' })).not.toBeInTheDocument(); expect(writes).toHaveLength(0);
});
it('preserves unchanged malformed and oversized nullable contacts exactly through separate review and correction', async () => {
  current = { ...current, name: '', contact_name: '  ' + 'c'.repeat(120), phone: 'old\nphone', email: ' old malformed address ', address: '\u0000' + 'x'.repeat(8100) };
  const retained = structuredClone(current); mount(`/inventory/suppliers/${supplierId}`); const ev = userEvent.setup(); await ev.click(await screen.findByRole('button', { name: 'Correct supplier details' }));
  fireEvent.change(screen.getByLabelText('Correction reason'), { target: { value: 'Keep exact retained contacts' } });
  expect(screen.getByLabelText('Email').tagName).toBe('TEXTAREA'); expect(screen.getByLabelText('Address')).not.toHaveAttribute('maxlength');
  await ev.click(screen.getByRole('button', { name: 'Refresh and review supplier change' })); await screen.findByRole('heading', { name: 'Review exact supplier change' });
  expect(screen.getByRole('button', { name: 'Confirm reviewed supplier change' })).toBeDisabled(); expect(writes).toHaveLength(0);
  await ev.click(screen.getByLabelText('I reviewed this exact supplier change')); await ev.click(screen.getByRole('button', { name: 'Confirm reviewed supplier change' })); await screen.findByText('Original supplier change confirmed');
  expect(writes).toHaveLength(1); for (const field of ['name', 'contact_name', 'phone', 'email', 'address']) expect(writes[0].body[field]).toBe(retained[field]);
});
it('creates with all four explicit nullable values while retaining empty text and server-valid quoted/IDN email text', async () => {
  mount(); const ev = userEvent.setup(); await ev.click(await screen.findByRole('button', { name: 'Add supplier' }));
  fireEvent.change(screen.getByLabelText('Permanent supplier code'), { target: { value: creation.code } }); fireEvent.change(screen.getByLabelText('Supplier name'), { target: { value: creation.name } });
  await select(ev, 'Contact name value', 'Enter text'); await select(ev, 'Email value', 'Enter text');
  const email = '"a b@c"@bücher.example'; fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  await review(ev); expect(writes).toHaveLength(0); await ev.click(screen.getByRole('button', { name: 'Confirm reviewed supplier change' })); await screen.findByText('Original supplier change confirmed');
  expect(writes[0].body).toMatchObject({ code: creation.code, name: creation.name, contact_name: '', phone: null, email, address: null }); expect(Object.keys(writes[0].body)).toHaveLength(7);
});
it('reactivates an unused retired supplier through separate current revision review', async () => {
  current.is_active = false; mount(`/inventory/suppliers/${supplierId}`); const ev = userEvent.setup(); await ev.click(await screen.findByRole('button', { name: 'Review supplier reactivation' })); await review(ev); await ev.click(screen.getByRole('button', { name: 'Confirm reviewed supplier change' })); await screen.findByText('Original supplier change confirmed');
  expect(writes).toHaveLength(1); expect(writes[0]).toMatchObject({ path: `/api/v2/inventory/suppliers/${supplierId}/reactivate`, body: { expected_version: 1, client_request_id: expect.any(String) } });
});
it('rejects malformed deep links without protected supplier reads or writes', async () => {
  mount('/inventory/suppliers/not-a-valid-reference'); await screen.findByRole('heading', { name: 'Inventory suppliers unavailable' });
  expect(fetch.mock.calls.filter(([url]) => new URL(url).pathname.includes('/inventory/supplier'))).toHaveLength(0); expect(writes).toHaveLength(0);
});
