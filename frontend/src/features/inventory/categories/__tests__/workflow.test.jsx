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
import InventoryCategoryPage from '../InventoryCategoryPage';
import { actorId, categoryId, parentId, category, parent, creation, detail, listItem, page, makeResult } from './fixtures';
const runtime = window.__HMS_RUNTIME_CONFIG__;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const reply = data => json({ data, meta: {} });
let user, current, currentParent, client, decision, binding, token, detailMode, listMode, parentListMode, parentNext, directoryPages, writeMode, pending, writes, receipts, receiptMode, blocker;
async function establish() {
  const principal = { id: user.id, facility_id: parentId, active_profile: 'hospital' }, transport = getV2ClientScopeKey(), authority = authorizationIdentity(user);
  binding = bindNetworkAccessGuard({ transportScope: transport, authorityScope: authority, readOwnerValue: JSON.stringify(user), principal }); activateWriteUncertainty(principal, { authority, transport });
  decision = await networkApi.current(); binding.update({ confirmed: true, decision });
}
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost/api/v2' };
  user = { id: actorId, role: 'ordinary', facilityCode: 'HMS', adminAccess: { capabilities: ['inventory.view', 'inventory.manage', 'patient.demographics.view', 'system.deployment_capabilities.view'] }, accessContext: { facility_id: parentId, active_profile: 'hospital', features: ['inventory'], patient_visibility: ['demographics'] } };
  token = clockToken(); current = structuredClone(category); currentParent = structuredClone(parent); receiptMode = detailMode = listMode = parentListMode = writeMode = 'ready'; pending = []; writes = []; receipts = new Map(); parentNext = false; directoryPages = 1; blocker = null;
  configureV2ApiClient({ getAccessToken: () => token.access_token, getFacilityCode: () => 'HMS', canRefreshSession: () => false });
  vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
    const address = new URL(url), path = address.pathname;
    if (path.endsWith('/auth/network-access')) return reply(clockNetwork());
    if (options.method === 'POST') {
      const body = JSON.parse(options.body), action = path.endsWith('/corrections') ? 'correct' : path.endsWith('/retire') ? 'retire' : path.endsWith('/reactivate') ? 'reactivate' : 'create'; writes.push({ path, body, signal: options.signal });
      if (writeMode === 'conflict') return json({ error: { code: 'inventory_category_version_conflict' } }, 409);
      const input = { action, ...(action !== 'create' ? { category_id: categoryId } : {}), ...body };
      let receipt = receipts.get(body.client_request_id); if (!receipt) { receipt = (await makeResult(input, current)).receipt; receipts.set(body.client_request_id, receipt); current = structuredClone(receipt.category); }
      if (writeMode === 'lost') throw new TypeError('Synthetic lost reply');
      if (writeMode === 'pending') return new Promise(resolve => pending.push(() => resolve(reply(receipt))));
      return reply(receipt);
    }
    if (path.includes('/category-commands/')) { if (receiptMode === 'denied') return json({ error: { code: 'authority_required' } }, 403); const receipt = receipts.get(path.split('/').at(-1)); return receipt ? reply(receipt) : json({ error: { code: 'inventory_category_not_found' } }, 404); }
    if (path.endsWith('/category-administration')) {
      if (address.searchParams.get('is_active') === 'true') {
        if (parentListMode === 'denied') return json({ error: { code: 'forbidden' } }, 403);
        if (parentListMode === 'failed') return json({ error: { code: 'inventory_category_read_failed' } }, 500);
        const next = address.searchParams.get('cursor'); return json({ ...page(next || !parentNext ? [listItem(currentParent)] : [listItem({ ...currentParent, id: '25252525-0000-4000-8000-000000000029', code: 'OTHER-PARENT', name: 'Synthetic first-page parent' })]), page: { limit: 25, has_next: parentNext && !next, next_cursor: parentNext && !next ? 'synthetic-parent-cursor' : null } });
      }
      if (listMode === 'denied') return json({ error: { code: 'forbidden' } }, 403);
      if (listMode === 'failed') return json({ error: { code: 'inventory_category_read_failed' } }, 500);
      if (directoryPages > 1) {
        const offset = Number((address.searchParams.get('cursor') ?? 'dir-0').slice(4));
        const rows = Array.from({ length: 25 }, (_, index) => ({ ...current, id: `25252525-0000-4000-8000-${String(offset + index + 100).padStart(12, '0')}`, name: `Synthetic directory category ${offset + index}` }));
        return json({ ...page(rows.map(listItem)), page: { limit: 25, has_next: offset + 25 < directoryPages * 25, next_cursor: offset + 25 < directoryPages * 25 ? `dir-${offset + 25}` : null } });
      }
      return json(page([listItem(current)]));
    }
    if (path.endsWith('/history')) return json(page([]));
    if (path.endsWith(`/${categoryId}/administration`)) {
      if (detailMode === 'pending') return new Promise(resolve => pending.push(response => resolve(response ?? reply(detail(current)))));
      if (detailMode === 'denied') return json({ error: { code: 'forbidden' } }, 403);
      return reply({ ...detail(current), eligibility: { ...detail(current).eligibility, lifecycle_blocked_by: blocker } });
    }
    if (path.endsWith(`/${parentId}/administration`)) return reply(detail(currentParent));
    if (path.endsWith('/dashboard/snapshot')) return json({ error: { code: 'forbidden' } }, 403);
    return json({ error: { code: 'synthetic_not_found' } }, 404);
  }));
  await establish(); client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: 3 } } });
});
afterEach(() => { cleanup(); client.clear(); __resetV2ApiClientForTests(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.__HMS_RUNTIME_CONFIG__ = runtime; });
function mount(path = '/inventory/categories') {
  const tree = () => <QueryClientProvider client={client}><AuthContext.Provider value={{ user }}><ReadOnlyModeProvider network={{ confirmed: true, decision }}><MemoryRouter initialEntries={[path]}><Routes><Route path="/inventory/categories/*" element={<InventoryCategoryPage />} /></Routes></MemoryRouter></ReadOnlyModeProvider></AuthContext.Provider></QueryClientProvider>;
  const view = render(tree()); return { ...view, update: () => view.rerender(tree()) };
}
async function openCorrection() { const ev = userEvent.setup(); await ev.click(await screen.findByRole('button', { name: 'Correct category details' })); fireEvent.change(screen.getByLabelText('Category name'), { target: { value: 'Synthetic reviewed correction' } }); fireEvent.change(screen.getByLabelText('Correction reason'), { target: { value: 'Synthetic exact reason' } }); return ev; }
async function review(ev) { await ev.click(screen.getByRole('button', { name: 'Refresh and review category change' })); await ev.click(await screen.findByLabelText('I reviewed this exact category change')); }
async function select(ev, label, option) { fireEvent.keyDown(screen.getByRole('combobox', { name: label }), { key: 'ArrowDown' }); await ev.click(await screen.findByRole('option', { name: option })); }
it.each(['footer', 'close icon', 'Escape'])('restores focus to the current category opener after unsent %s dismissal', async method => {
  mount(`/inventory/categories/${categoryId}`); const ev = userEvent.setup(), opener = await screen.findByRole('button', { name: 'Correct category details' }); await ev.click(opener); await screen.findByRole('dialog');
  if (method === 'footer') await ev.click(screen.getByRole('button', { name: 'Close category review' }));
  else if (method === 'close icon') await ev.click(screen.getByRole('button', { name: 'Close', exact: true }));
  else await ev.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); await waitFor(() => expect(opener).toHaveFocus()); expect(writes).toHaveLength(0);
});
it('restores focus to a current page action after a confirmed category finish replaces the original opener', async () => {
  mount(`/inventory/categories/${categoryId}`); const opener = await screen.findByRole('button', { name: 'Correct category details' }), ev = await openCorrection(); await review(ev); await ev.click(screen.getByRole('button', { name: 'Confirm reviewed category change' })); await screen.findByText('Original category change confirmed');
  await waitFor(() => expect(opener.isConnected).toBe(false)); await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh categories and finish review' })).toBeEnabled()); await ev.click(screen.getByRole('button', { name: 'Refresh categories and finish review' })); await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); await waitFor(() => expect(screen.getByRole('button', { name: 'Back to categories' })).toHaveFocus()); expect(writes).toHaveLength(1);
});
it.each(['denial', 'scope change', 'scope ABA', 'unmount'])('does not restore category focus to an old opener after %s', async transition => {
  const view = mount(`/inventory/categories/${categoryId}`), opener = await screen.findByRole('button', { name: 'Correct category details' }), ev = await openCorrection(), original = structuredClone(user), focus = vi.spyOn(opener, 'focus'), allFocus = vi.spyOn(HTMLElement.prototype, 'focus');
  if (transition === 'denial') { detailMode = 'denied'; await ev.click(screen.getByRole('button', { name: 'Refresh and review category change' })); await screen.findByRole('heading', { name: 'Inventory categories unavailable' }); }
  else if (transition.startsWith('scope')) { user = { ...user, id: '25252525-0000-4000-8000-000000000039' }; await act(async () => { await establish(); view.update(); }); await screen.findByRole('button', { name: 'Correct category details' }); if (transition === 'scope ABA') { user = original; await act(async () => { await establish(); view.update(); }); await screen.findByRole('button', { name: 'Correct category details' }); } }
  else view.unmount();
  await waitFor(() => expect(opener.isConnected).toBe(false)); await act(async () => new Promise(resolve => setTimeout(resolve, 0))); expect(focus).not.toHaveBeenCalled(); if (transition.startsWith('scope')) { expect(allFocus.mock.instances).not.toContain(screen.getByRole('button', { name: 'Correct category details' })); expect(allFocus.mock.instances).not.toContain(screen.getByRole('button', { name: 'Back to categories' })); } expect(writes).toHaveLength(0);
});
it('browses exact category metadata/history with actual transport, without a mount write or legacy stock fields', async () => {
  mount(); const ev = userEvent.setup(); await ev.click(await screen.findByRole('button', { name: `View category details for ${category.name}` })); await screen.findByRole('heading', { name: 'Category recording history' }); expect(screen.getByText('Permanent category identity')).toBeInTheDocument(); expect(writes).toHaveLength(0); expect(screen.queryByText(/unit price/i)).not.toBeInTheDocument();
});
it('browses beyond100 records with bounded server cursor pages and resets cursor after explicit search or status change', async () => {
  directoryPages = 5; mount(); const ev = userEvent.setup(); await screen.findByRole('button', { name: 'View category details for Synthetic directory category 0' });
  for (let index = 1; index <= 4; index++) { await ev.click(screen.getByRole('button', { name: 'Next' })); await screen.findByRole('button', { name: `View category details for Synthetic directory category ${index * 25}` }); }
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled(); expect(fetch.mock.calls.filter(([url]) => new URL(url).pathname.endsWith('/category-administration'))).toHaveLength(5);
  fireEvent.change(screen.getByLabelText('Find a category by name or code'), { target: { value: 'Synthetic literal search' } }); await ev.click(screen.getByRole('button', { name: 'Search categories' })); await screen.findByRole('button', { name: 'View category details for Synthetic directory category 0' });
  let url = new URL(fetch.mock.calls.at(-1)[0]); expect(url.searchParams.get('search')).toBe('Synthetic literal search'); expect(url.searchParams.has('cursor')).toBe(false);
  await select(ev, 'Status', 'Retired'); await waitFor(() => expect(new URL(fetch.mock.calls.at(-1)[0]).searchParams.get('is_active')).toBe('false')); url = new URL(fetch.mock.calls.at(-1)[0]); expect(url.searchParams.has('cursor')).toBe(false); expect(writes).toHaveLength(0);
});
it('fresh lifecycle review rechecks retained references and performs an unused retirement with its exact UUID/CAS only', async () => {
  mount(`/inventory/categories/${categoryId}`); const ev = userEvent.setup(); await ev.click(await screen.findByRole('button', { name: 'Review category retirement' })); blocker = 'child_reference'; await ev.click(screen.getByRole('button', { name: 'Refresh and review category change' })); expect(await screen.findByText(/retained item or current child reference blocks/i)).toBeInTheDocument(); expect(writes).toHaveLength(0);
  blocker = null; await review(ev); await ev.click(screen.getByRole('button', { name: 'Confirm reviewed category change' })); await screen.findByText('Original category change confirmed'); expect(writes[0].path).toBe(`/api/v2/inventory/categories/${categoryId}/retire`); expect(writes[0].body).toEqual({ client_request_id: expect.any(String), expected_version: 1 });
});
it.each(['permission', 'feature', 'demographics', 'visibility', 'deployment'])('rejects missing %s even with an admin label before protected reads', missing => {
  user.role = 'admin'; if (missing === 'permission') user.adminAccess.capabilities = []; if (missing === 'feature') user.accessContext.features = []; if (missing === 'demographics') user.adminAccess.capabilities = ['inventory.view', 'inventory.manage', 'system.deployment_capabilities.view']; if (missing === 'visibility') user.accessContext.patient_visibility = []; if (missing === 'deployment') user.adminAccess.capabilities = user.adminAccess.capabilities.filter(value => value !== 'system.deployment_capabilities.view');
  fetch.mockClear(); mount(); expect(screen.getByRole('heading', { name: 'Inventory categories unavailable' })).toBeInTheDocument(); expect(fetch).not.toHaveBeenCalled();
});
it('keeps view-only categories readable and hides manager controls and original-receipt discovery', async () => {
  user.adminAccess.capabilities = user.adminAccess.capabilities.filter(value => value !== 'inventory.manage'); await establish(); mount(`/inventory/categories/${categoryId}`); await screen.findByRole('heading', { name: 'Category recording history' }); expect(screen.queryByRole('button', { name: 'Correct category details' })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Add category' })).not.toBeInTheDocument(); expect(writes).toHaveLength(0);
});
it('preserves unchanged blank/long historical metadata, nullable description and unavailable retained parent in a separate-confirmation correction', async () => {
  current = { ...current, name: '', description: 'x'.repeat(8001), parent_id: parentId, parent: null }; mount(`/inventory/categories/${categoryId}`); const ev = await openCorrection(); fireEvent.change(screen.getByLabelText('Category name'), { target: { value: '' } }); await review(ev); expect(writes).toHaveLength(0);
  await ev.click(screen.getByRole('button', { name: 'Confirm reviewed category change' })); await screen.findByText('Original category change confirmed'); expect(writes).toHaveLength(1); expect(writes[0].body).toMatchObject({ client_request_id: expect.any(String), expected_version: 1, name: '', description: 'x'.repeat(8001), parent_change: { action: 'retain' } }); expect(Object.hasOwn(writes[0].body, 'code')).toBe(false);
});
it('requires an explicit nullable parent choice for creation and preserves empty description separately from null', async () => {
  mount(); const ev = userEvent.setup(); await ev.click(await screen.findByRole('button', { name: 'Add category' })); fireEvent.change(screen.getByLabelText('Permanent category code'), { target: { value: creation.code } }); fireEvent.change(screen.getByLabelText('Category name'), { target: { value: creation.name } });
  await ev.click(screen.getByRole('button', { name: 'Refresh and review category change' })); expect(await screen.findByRole('alert')).toHaveTextContent('Explicitly choose');
  await select(ev, 'Parent relationship', 'No direct parent'); await select(ev, 'Description value', 'Plain text, including empty text'); expect(screen.getByLabelText('Plain-text description')).toHaveValue(''); await review(ev); await ev.click(screen.getByRole('button', { name: 'Confirm reviewed category change' })); await screen.findByText('Original category change confirmed'); expect(writes[0].body).toMatchObject({ description: '', parent: null });
});
it('selects a versioned parent beyond the first page and separately reads its exact current revision', async () => {
  parentNext = true; mount(`/inventory/categories/${categoryId}`); const ev = await openCorrection(); await select(ev, 'Parent relationship', 'Choose a direct parent'); await ev.click(await screen.findByRole('button', { name: 'Next parent category page' })); await ev.click(await screen.findByRole('button', { name: 'Synthetic parent (PARENT-25) · Revision 1' })); await screen.findByText(`Current exact parent: ${parentId}`); await review(ev); expect(writes).toHaveLength(0);
  await ev.click(screen.getByRole('button', { name: 'Confirm reviewed category change' })); await screen.findByText('Original category change confirmed'); expect(writes[0].body.parent_change).toEqual({ action: 'set', parent_id: parentId, expected_parent_version: 1 });
});
it('a later failed parent candidate page invalidates selection; a selected-detail200 alone cannot restore it', async () => {
  mount(`/inventory/categories/${categoryId}`); const ev = await openCorrection(); await select(ev, 'Parent relationship', 'Choose a direct parent'); await ev.click(await screen.findByRole('button', { name: 'Synthetic parent (PARENT-25) · Revision 1' })); await screen.findByText(`Current exact parent: ${parentId}`); await review(ev);
  parentListMode = 'failed'; await ev.click(screen.getByRole('button', { name: 'Refresh parents' })); await screen.findByText('Current parent candidates are unavailable. An earlier selection cannot authorize a change.'); expect(screen.queryByLabelText('I reviewed this exact category change')).not.toBeInTheDocument();
  await act(async () => client.refetchQueries({ predicate: query => query.queryKey.includes('category') })); await ev.click(screen.getByRole('button', { name: 'Refresh and review category change' })); expect(await screen.findByText('Choose an exact active parent from a current authorized category page.')).toBeInTheDocument(); expect(writes).toHaveLength(0);
});
it('rejects a parent revision change during preparation with no consent or POST', async () => {
  mount(`/inventory/categories/${categoryId}`); const ev = await openCorrection(); await select(ev, 'Parent relationship', 'Choose a direct parent'); await ev.click(await screen.findByRole('button', { name: 'Synthetic parent (PARENT-25) · Revision 1' })); await screen.findByText(`Current exact parent: ${parentId}`); currentParent.version++;
  await ev.click(screen.getByRole('button', { name: 'Refresh and review category change' })); expect(await screen.findByText(/selected parent changed after selection/i)).toBeInTheDocument(); expect(screen.queryByLabelText('I reviewed this exact category change')).not.toBeInTheDocument(); expect(writes).toHaveLength(0);
});
it('retains one exact unknown request across close and navigation, then confirms the original result without another POST', async () => {
  mount(`/inventory/categories/${categoryId}`); const ev = await openCorrection(); await review(ev); writeMode = 'lost'; await ev.click(screen.getByRole('button', { name: 'Confirm reviewed category change' })); await screen.findByText('Category change needs reconciliation'); expect(writes).toHaveLength(1);
  await ev.click(screen.getByRole('button', { name: 'Close category review' })); await ev.click(screen.getByRole('button', { name: 'Back to categories' })); await screen.findByRole('button', { name: `View category details for ${current.name}` }); await ev.click(screen.getByRole('button', { name: 'Review pending category change' })); await ev.click(screen.getByRole('button', { name: 'Check original category result' })); await screen.findByText('Original category change confirmed'); expect(writes).toHaveLength(1); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
it('keeps one synchronous write latch and locks dismissal while the actual POST runs despite mutation retry defaults', async () => {
  mount(`/inventory/categories/${categoryId}`); const ev = await openCorrection(); await review(ev); writeMode = 'pending'; const submit = screen.getByRole('button', { name: 'Confirm reviewed category change' }); fireEvent.click(submit); fireEvent.click(submit); await waitFor(() => expect(pending).toHaveLength(1)); expect(writes).toHaveLength(1); expect(screen.getByRole('button', { name: 'Close category review' })).toBeDisabled(); await act(async () => pending[0]()); await screen.findByText('Original category change confirmed');
});
it('cancels only read preparation and rejects a late result after close/reopen', async () => {
  mount(`/inventory/categories/${categoryId}`); const ev = await openCorrection(); detailMode = 'pending'; fireEvent.click(screen.getByRole('button', { name: 'Refresh and review category change' })); await waitFor(() => expect(pending).toHaveLength(1)); const old = pending[0], oldRequest = fetch.mock.calls.at(-1)[1]; await ev.click(screen.getByRole('button', { name: 'Close category review' })); expect(oldRequest.signal.aborted).toBe(true);
  await ev.click(screen.getByRole('button', { name: 'Correct category details' })); detailMode = 'ready'; await review(ev); await act(async () => old()); expect(screen.getByRole('heading', { name: 'Review exact category change' })).toBeVisible(); expect(writes).toHaveLength(0);
});
it('clears consent on same-version/same-clock actual source refresh', async () => {
  mount(`/inventory/categories/${categoryId}`); const ev = await openCorrection(); await review(ev); await act(async () => client.invalidateQueries()); await waitFor(() => expect(screen.queryByLabelText('I reviewed this exact category change')).not.toBeInTheDocument()); expect(writes).toHaveLength(0);
});
it('genuine current403 conceals cached detail and private draft even after invalidating its own clock', async () => {
  mount(`/inventory/categories/${categoryId}`); const ev = await openCorrection(); detailMode = 'denied'; await ev.click(screen.getByRole('button', { name: 'Refresh and review category change' })); await screen.findByRole('heading', { name: 'Inventory categories unavailable' }); expect(screen.queryByDisplayValue('Synthetic reviewed correction')).not.toBeInTheDocument(); expect(writes).toHaveLength(0);
});
it('keeps cached rows hidden after403 then500 until an explicit fresh200', async () => {
  const view = mount(); await screen.findByRole('button', { name: `View category details for ${category.name}` }); listMode = 'denied'; fireEvent.click(screen.getByRole('button', { name: 'Refresh categories' })); await screen.findByRole('heading', { name: 'Inventory categories unavailable' }); listMode = 'failed'; expect(networkClockCurrent(decision)).toBe(false); await act(async () => { await establish(); view.update(); }); expect(networkClockCurrent(decision)).toBe(true); fireEvent.click(screen.getByRole('button', { name: 'Retry' })); await screen.findByRole('heading', { name: 'Category could not be loaded' }); expect(screen.queryByRole('button', { name: `View category details for ${category.name}` })).not.toBeInTheDocument();
  listMode = 'ready'; fireEvent.click(screen.getByRole('button', { name: 'Retry' })); await screen.findByRole('button', { name: `View category details for ${category.name}` });
});
it('genuine original receipt403 conceals retained unknown fields while retaining opaque uncertainty', async () => {
  mount(`/inventory/categories/${categoryId}`); const ev = await openCorrection(); await review(ev); writeMode = 'lost'; await ev.click(screen.getByRole('button', { name: 'Confirm reviewed category change' })); await screen.findByText('Category change needs reconciliation'); receiptMode = 'denied'; await ev.click(screen.getByRole('button', { name: 'Check original category result' })); await screen.findByRole('heading', { name: 'Inventory categories unavailable' }); expect(screen.queryByText('Category change needs reconciliation')).not.toBeInTheDocument(); expect(getWriteUncertaintySnapshot().entries).toHaveLength(1); expect(writes).toHaveLength(1);
});
it.each(['actor', 'facility', 'profile', 'permission', 'feature', 'visibility'])('committed %s A→B→A removes unsent intent and rejects an old actual403', async kind => {
  const view = mount(`/inventory/categories/${categoryId}`), ev = await openCorrection(); detailMode = 'pending'; fireEvent.click(screen.getByRole('button', { name: 'Refresh and review category change' })); await waitFor(() => expect(pending).toHaveLength(1)); const old = pending[0], original = structuredClone(user);
  if (kind === 'actor') user = { ...user, id: '25252525-0000-4000-8000-000000000039' };
  if (kind === 'facility') user = { ...user, facilityCode: 'OTHER', accessContext: { ...user.accessContext, facility_id: '25252525-0000-4000-8000-000000000039' } };
  if (kind === 'profile') user = { ...user, accessContext: { ...user.accessContext, active_profile: 'other' } };
  if (kind === 'permission') user = { ...user, adminAccess: { capabilities: [] } };
  if (kind === 'feature') user = { ...user, accessContext: { ...user.accessContext, features: [] } };
  if (kind === 'visibility') user = { ...user, accessContext: { ...user.accessContext, patient_visibility: [] } };
  detailMode = 'ready'; await act(async () => { await establish(); view.update(); }); await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  user = original; await act(async () => { await establish(); view.update(); }); await screen.findByRole('button', { name: 'Correct category details' }); await ev.click(screen.getByRole('button', { name: 'Correct category details' })); expect(screen.getByLabelText('Category name')).toHaveValue(category.name);
  await act(async () => old(json({ error: { code: 'synthetic_old_ABA_denial' } }, 403))); expect(screen.queryByRole('heading', { name: 'Inventory categories unavailable' })).not.toBeInTheDocument(); expect(screen.getByLabelText('Category name')).toHaveValue(category.name); expect(writes).toHaveLength(0);
});
it('settles preparation after an unrelated current403 without publishing stale review', async () => {
  const view = mount(`/inventory/categories/${categoryId}`); await openCorrection(); const originalClock = decision, reasonInput = screen.getByLabelText('Correction reason'); detailMode = 'pending'; fireEvent.click(screen.getByRole('button', { name: 'Refresh and review category change' })); await waitFor(() => expect(pending).toHaveLength(1)); await act(async () => { await v2Request({ path: '/api/v2/dashboard/snapshot' }).catch(() => {}); pending[0](); });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh and review category change' })).toBeDisabled());
  expect(screen.queryByRole('button', { name: 'Confirming current category…' })).not.toBeInTheDocument();
  expect(networkClockCurrent(originalClock)).toBe(false);
  expect(screen.queryByRole('heading', { name: 'Review exact category change' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('I reviewed this exact category change')).not.toBeInTheDocument();
  expect(writes).toHaveLength(0);
  detailMode = 'ready'; await act(async () => { await establish(); view.update(); });
  expect(networkClockCurrent(decision)).toBe(true); expect(networkClockCurrent(originalClock)).toBe(false);
  expect(screen.getByLabelText('Correction reason')).toBe(reasonInput);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh and review category change' })).toBeEnabled()); expect(screen.queryByRole('heading', { name: 'Review exact category change' })).not.toBeInTheDocument(); expect(writes).toHaveLength(0);
});
