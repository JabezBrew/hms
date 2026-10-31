import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { __resetV2ApiClientForTests, configureV2ApiClient, getV2ClientScopeKey, v2Request } from '@/lib/api/v2/client';
import { bindNetworkAccessGuard } from '@/lib/api/v2/networkAccessGuard';
import { activateWriteUncertainty, acknowledgeWriteResponse, assertWriteRecoveryReadCurrent, getWriteUncertaintySnapshot, inventoryItemCommandRecoveryCandidate, WRITE_UNCERTAINTY_KEY } from '@/lib/api/v2/writeUncertainty';
import { isCurrentReadDenial } from '@/lib/api/v2/readDenials';
import { networkApi } from '@/features/settings/network/api';
import { clockToken, clockNetwork } from '@/features/auth/__tests__/clock-fixtures';
import { inventoryCatalogApi } from '../api';
import { commandWire } from '../commandWire';
import { prepareCommand } from '../model';
import { actorId, categoryId, correction, creation, item, itemId, page, requestId, makeResult } from './fixtures';
const runtime = window.__HMS_RUNTIME_CONFIG__;
const principal = { id: actorId, facility_id: categoryId, active_profile: 'hospital' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const reply = data => json({ data, meta: {} });
let binding, authority, token;
beforeEach(async () => {
 vi.stubGlobal('crypto', webcrypto); __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost/api/v2' };
 token = clockToken(); authority = 'synthetic-catalog-current-authority';
 configureV2ApiClient({ getAccessToken: () => token.access_token, getFacilityCode: () => 'HMS', canRefreshSession: () => false });
 const transport = getV2ClientScopeKey(); binding = bindNetworkAccessGuard({ transportScope: transport, authorityScope: authority, principal, readOwnerValue: JSON.stringify(principal) });
 activateWriteUncertainty(principal, { authority, transport });
 vi.stubGlobal('fetch', vi.fn(async () => reply(clockNetwork()))); binding.update({ confirmed: true, decision: await networkApi.current() }); fetch.mockReset();
});
afterEach(() => { __resetV2ApiClientForTests(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.__HMS_RUNTIME_CONFIG__ = runtime; });
it.each(['create', 'correct', 'retire', 'reactivate'])('sends actual generated %s with exact reviewed UUID/CAS and signal', async action => {
 const input = action === 'create' ? creation : action === 'correct' ? correction : { action, client_request_id: requestId, item_id: itemId, expected_version: 1 };
 const previous = { ...item, is_active: action !== 'reactivate' }, { command, receipt } = await makeResult(input, previous), controller = new AbortController();
 fetch.mockResolvedValueOnce(reply(receipt)); const result = await inventoryCatalogApi.write(command, { signal: controller.signal }); expect(result.receipt).toEqual(receipt);
 const [url, options] = fetch.mock.calls[0], wire = commandWire(command.input); expect(new URL(url).pathname).toBe(wire.path); expect(options.method).toBe('POST'); expect(options.signal).toBe(controller.signal); expect(JSON.parse(options.body)).toEqual(wire.body);
 expect(Object.hasOwn(wire.body, 'action')).toBe(false); expect(wire.body.client_request_id).toBe(requestId); expect(wire.body.item_id).toBe(action === 'correct' ? itemId : undefined); acknowledgeWriteResponse(result.response); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
it('uses actual optional directory/history/category query metadata and bounded cursor envelopes', async () => {
 const abort = new AbortController(); fetch.mockResolvedValueOnce(json(page([item]))); const list = await inventoryCatalogApi.list({ search: 'Synthetic & exact', is_active: false, cursor: 'opaque-current', limit: 25 }, { signal: abort.signal });
 expect(list.value).toEqual(page([item])); let url = new URL(fetch.mock.calls[0][0]); expect(url.pathname).toBe('/api/v2/inventory/items/administration'); expect(Object.fromEntries(url.searchParams)).toEqual({ limit: '25', search: 'Synthetic & exact', is_active: 'false', cursor: 'opaque-current' }); expect(fetch.mock.calls[0][1].signal).toBe(abort.signal);
 expect(list.value).toBe(list.response); assertWriteRecoveryReadCurrent(list.response); expect(() => assertWriteRecoveryReadCurrent({ ...list.response })).toThrow();
 fetch.mockResolvedValueOnce(json(page([]))); const history = await inventoryCatalogApi.history(itemId, { cursor: 'opaque-history', limit: 25 }); url = new URL(fetch.mock.calls[1][0]); expect(url.pathname).toBe(`/api/v2/inventory/items/${itemId}/catalog-history`); expect(Object.fromEntries(url.searchParams)).toEqual({ limit: '25', cursor: 'opaque-history' }); expect(history.value).toBe(history.response); assertWriteRecoveryReadCurrent(history.response);
 fetch.mockResolvedValueOnce(json(page([item.category]))); const categories = await inventoryCatalogApi.categories({ cursor: 'opaque-category', search: 'Synthetic', limit: 25 }); expect(categories.value.data).toEqual([item.category]); url = new URL(fetch.mock.calls[2][0]); expect(Object.fromEntries(url.searchParams)).toEqual({ limit: '25', cursor: 'opaque-category', search: 'Synthetic' });
 expect(categories.value).toBe(categories.response); assertWriteRecoveryReadCurrent(categories.response);
});
it('uses exact administration detail and preserves the actual current403 error witness despite own clock invalidation', async () => {
 fetch.mockResolvedValueOnce(reply({ item, eligibility: { unit_change_blocked_by: null, lifecycle_blocked_by: null } })); expect((await inventoryCatalogApi.get(itemId)).value.item).toEqual(item);
 fetch.mockResolvedValueOnce(json({ error: { code: 'forbidden' } }, 403)); const denial = await inventoryCatalogApi.get(itemId).catch(error => error); expect(denial.status).toBe(403); expect(isCurrentReadDenial(denial)).toBe(true); expect(isCurrentReadDenial({ ...denial })).toBe(false);
});
it('recovers only actual original actor/input/fingerprint evidence, then separately acknowledges retained uncertainty', async () => {
 const { command, receipt } = await makeResult(); fetch.mockRejectedValueOnce(new TypeError('Synthetic lost response')); const unknown = await inventoryCatalogApi.write(command).catch(error => error);
 expect(unknown.name).toBe('InventoryItemUnconfirmedError'); expect(await inventoryItemCommandRecoveryCandidate()).toBe(requestId); expect(() => acknowledgeWriteResponse(unknown)).toThrow();
 fetch.mockResolvedValueOnce(reply(receipt)); const original = await inventoryCatalogApi.recover(command); expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(true); assertWriteRecoveryReadCurrent(original.response); expect(() => assertWriteRecoveryReadCurrent({ ...original.response })).toThrow(); acknowledgeWriteResponse(unknown); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
 fetch.mockResolvedValueOnce(reply(receipt)); expect((await inventoryCatalogApi.original(requestId, actorId)).receipt).toEqual(receipt); expect(new URL(fetch.mock.calls.at(-1)[0]).pathname).toBe(`/api/v2/inventory/item-commands/${requestId}`);
});
it.each(['directory', 'detail', 'history', 'category', 'ordinary'])('never lets %s reads review a keyed lost write', async kind => {
 const { command } = await makeResult(); fetch.mockRejectedValueOnce(new TypeError('Synthetic lost')); await inventoryCatalogApi.write(command).catch(() => {});
 if (kind === 'directory') { fetch.mockResolvedValueOnce(json(page([item]))); await inventoryCatalogApi.list(); }
 if (kind === 'detail') { fetch.mockResolvedValueOnce(reply({ item, eligibility: { unit_change_blocked_by: null, lifecycle_blocked_by: null } })); await inventoryCatalogApi.get(itemId); }
 if (kind === 'history') { fetch.mockResolvedValueOnce(json(page([]))); await inventoryCatalogApi.history(itemId); }
 if (kind === 'category') { fetch.mockResolvedValueOnce(json(page([item.category]))); await inventoryCatalogApi.categories(); }
 if (kind === 'ordinary') { fetch.mockResolvedValueOnce(reply({ id: itemId })); await v2Request({ path: '/api/v2/inventory/items/{id}', pathParams: { id: itemId } }); }
 expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(false);
});
it('refuses a valid actor receipt with the same UUID but a different request fingerprint', async () => {
 const { command } = await makeResult(); fetch.mockRejectedValueOnce(new TypeError('Synthetic lost')); const unknown = await inventoryCatalogApi.write(command).catch(error => error);
 const altered = await makeResult({ ...correction, name: 'Another reviewed synthetic name' }); fetch.mockResolvedValueOnce(reply(altered.receipt)); await v2Request({ path: '/api/v2/inventory/item-commands/{client_request_id}', pathParams: { client_request_id: requestId } });
 expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(false); expect(() => acknowledgeWriteResponse(unknown)).toThrow();
});
it.each(['actor', 'UUID', 'digest', 'body'])('keeps original %s corruption unreviewed and unknown', async fault => {
 const { command, receipt } = await makeResult(); fetch.mockRejectedValueOnce(new TypeError('Synthetic lost')); await inventoryCatalogApi.write(command).catch(() => {});
 if (fault === 'actor') receipt.recorded_by_user_id = itemId; if (fault === 'UUID') receipt.client_request_id = itemId; if (fault === 'digest') receipt.input_digest = '0'.repeat(64); if (fault === 'body') receipt.reviewed_input.reason = 'Another synthetic reason';
 fetch.mockResolvedValueOnce(reply(receipt)); await expect(inventoryCatalogApi.recover(command)).rejects.toThrow(); expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(false);
});
it('permits only explicit identical replay while altered input remains barred', async () => {
 const { command, receipt } = await makeResult(); fetch.mockRejectedValueOnce(new TypeError('Synthetic lost')); await inventoryCatalogApi.write(command).catch(() => {});
 const altered = await prepareCommand({ ...correction, name: 'Another synthetic choice' }, actorId, item); await expect(inventoryCatalogApi.write(altered)).rejects.toMatchObject({ status: 409 }); expect(fetch).toHaveBeenCalledTimes(1);
 fetch.mockResolvedValueOnce(reply(receipt)); await inventoryCatalogApi.write(command); expect(fetch).toHaveBeenCalledTimes(2); expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(JSON.parse(fetch.mock.calls[1][1].body));
});
it('preserves typed definite conflicts and creates unknown state for malformed successful receipts', async () => {
 const { command, receipt } = await makeResult(); fetch.mockResolvedValueOnce(json({ error: { code: 'inventory_item_version_conflict' } }, 409)); await expect(inventoryCatalogApi.write(command)).rejects.toMatchObject({ status: 409 }); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
 receipt.input_digest = '0'.repeat(64); fetch.mockResolvedValueOnce(reply(receipt)); await expect(inventoryCatalogApi.write(command)).rejects.toMatchObject({ name: 'InventoryItemUnconfirmedError' }); expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(false);
});
it('does not dispatch a canceled operation or accept an actor copied from another owner', async () => {
 const { command } = await makeResult(), controller = new AbortController(); controller.abort(); await expect(inventoryCatalogApi.write(command, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
 const other = await prepareCommand(correction, itemId, item); await expect(inventoryCatalogApi.write(other)).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
});
it('reload candidate refuses unkeyed markers rather than inventing a request UUID', async () => {
 fetch.mockRejectedValueOnce(new TypeError('Synthetic old loss')); await v2Request({ method: 'POST', path: '/api/v2/inventory/catalog-edits', body: { item_id: itemId, code: item.code, name: item.name, unit: item.unit, reason: 'Synthetic old', effective_from: '2020-01-01' } }).catch(() => {});
 expect(JSON.parse(sessionStorage.getItem(WRITE_UNCERTAINTY_KEY)).entries[0].uuid).toBe(null); expect(await inventoryItemCommandRecoveryCandidate()).toBe(null);
 fetch.mockResolvedValueOnce(reply({ id: itemId })); await v2Request({ path: '/api/v2/inventory/items/{id}', pathParams: { id: itemId } }); expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(false);
});
