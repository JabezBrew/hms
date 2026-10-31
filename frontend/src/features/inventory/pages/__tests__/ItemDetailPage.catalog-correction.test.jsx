import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ItemDetailPage from '../ItemDetailPage';
import { inventoryApi } from '@/lib/api/inventory';
import { inventoryKeys } from '@/hooks/useInventoryQueries';
import { configureV2ApiClient, __resetV2ApiClientForTests, getV2ClientScopeKey } from '@/lib/api/v2/session';
import { bindNetworkAccessGuard } from '@/lib/api/v2/networkAccessGuard';
import { isCurrentReadDenial } from '@/lib/api/v2/readDenials';
const runtime = window.__HMS_RUNTIME_CONFIG__, itemId = '24242424-0000-4000-8000-000000000031';
const item = { id: itemId, code: 'SYNTHETIC-CLOSED', sku: 'SYNTHETIC-CLOSED', name: 'Synthetic protected stock item', unit: 'pack', unit_of_measure: 'pack', category_name: 'Synthetic supplies', total_stock: 1, is_active: true };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
let client, status, token;
function bind() { bindNetworkAccessGuard({ transportScope: getV2ClientScopeKey(), authorityScope: 'synthetic-stock-owner', readOwnerValue: token, principal: { id: '24242424-0000-4000-8000-000000000032', facility_id: '24242424-0000-4000-8000-000000000033', active_profile: 'hospital' } }); }
beforeEach(() => {
 __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost/api/v2' }; token = 'synthetic-current-stock-owner'; configureV2ApiClient({ getAccessToken: () => token, getFacilityCode: () => 'HMS', canRefreshSession: () => false }); bind(); status = 200;
 client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
 vi.stubGlobal('fetch', vi.fn(async () => json(status === 200 ? { data: item } : { error: { code: 'synthetic_current_denial' } }, status)));
});
afterEach(() => { cleanup(); client.clear(); __resetV2ApiClientForTests(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.__HMS_RUNTIME_CONFIG__ = runtime; });
function mount() { return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/inventory/items/${itemId}`]}><Routes><Route path="/inventory/items/:id" element={<ItemDetailPage />} /><Route path="/inventory/catalog/:id" element={<h1>Separate governed catalog destination</h1>} /></Routes></MemoryRouter></QueryClientProvider>); }
it('replaces the old editable stock modal with exact catalog navigation and submits no legacy write', async () => {
 mount(); await userEvent.setup().click(await screen.findByRole('button', { name: 'Open catalog administration' })); await screen.findByRole('heading', { name: 'Separate governed catalog destination' }); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(fetch.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(0);
});
it('opens catalog as a separate read destination for an inactive item without granting management', async () => {
 fetch.mockResolvedValueOnce(json({ data: { ...item, is_active: false } })); mount(); await screen.findByRole('button', { name: 'Open catalog administration' }); expect(screen.queryByRole('button', { name: 'Correct catalog details' })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument();
});
it('preserves actual Rust current403 status and its uncopyable denial identity', async () => { status = 403; const error = await inventoryApi.getInventoryItem(itemId).catch(error => error); expect(error.status).toBe(403); expect(isCurrentReadDenial(error)).toBe(true); expect(isCurrentReadDenial({ ...error })).toBe(false); });
it('conceals cached stock content after current200→403 and does not revive it after a later500', async () => {
 mount(); await screen.findByRole('heading', { name: item.name }); status = 403; await act(async () => client.invalidateQueries({ queryKey: inventoryKeys.itemDetail(itemId) })); await screen.findByRole('heading', { name: 'Inventory item unavailable' }); expect(screen.queryByRole('heading', { name: item.name })).not.toBeInTheDocument();
 status = 500; await act(async () => client.invalidateQueries({ queryKey: inventoryKeys.itemDetail(itemId) })); expect(screen.getByRole('heading', { name: 'Inventory item unavailable' })).toBeInTheDocument(); expect(screen.queryByRole('heading', { name: item.name })).not.toBeInTheDocument();
});
it('an old owner403 has no current denial authority and cannot conceal a new successful stock view', async () => {
 let resolve; fetch.mockImplementationOnce(() => new Promise(done => { resolve = done; })); const old = inventoryApi.getInventoryItem(itemId).catch(error => error); await waitFor(() => expect(resolve).toBeTypeOf('function'));
 token = 'synthetic-different-stock-owner'; bind(); mount(); await screen.findByRole('heading', { name: item.name }); await act(async () => resolve(json({ error: { code: 'synthetic_old_owner_denied' } }, 403))); expect(isCurrentReadDenial(await old)).toBe(false); expect(screen.getByRole('heading', { name: item.name })).toBeVisible();
});
it('preserves AbortError in the exact stock helper without translation', async () => { const error = new DOMException('Aborted', 'AbortError'); fetch.mockRejectedValueOnce(error); await expect(inventoryApi.getInventoryItem(itemId)).rejects.toBe(error); });
it('keeps Django item editing independent of the closed Rust correction entry', async () => {
 window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'django' }; fetch.mockResolvedValueOnce(json(item)); mount(); await screen.findByRole('heading', { name: item.name }); expect(screen.getByRole('button', { name: /^edit$/i })).toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Open catalog administration' })).not.toBeInTheDocument();
});
