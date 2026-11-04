import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { __resetV2ApiClientForTests, configureV2ApiClient, getV2ClientScopeKey, v2Request } from '@/lib/api/v2/client';
import { bindNetworkAccessGuard } from '@/lib/api/v2/networkAccessGuard';
import { activateWriteUncertainty, acknowledgeWriteResponse, acknowledgeWriteReview, assertWriteRecoveryReadCurrent, getWriteUncertaintySnapshot, inventorySupplierCommandRecoveryCandidate, resetWriteUncertaintyForTests, WRITE_UNCERTAINTY_KEY } from '@/lib/api/v2/writeUncertainty';
import { isCurrentReadDenial } from '@/lib/api/v2/readDenials';
import { networkApi } from '@/features/settings/network/api';
import { clockToken, clockNetwork } from '@/features/auth/__tests__/clock-fixtures';
import { inventorySupplierApi } from '../api';
import { commandWire } from '../commandWire';
import { canonical, prepareCommand } from '../model';
import { actorId, supplier, supplierId, correction, creation, detail, historyId, listItem, page, otherSupplier, otherId, requestId, makeResult, stamp } from './fixtures';
const runtime = window.__HMS_RUNTIME_CONFIG__, principal = { id: actorId, facility_id: otherId, active_profile: 'hospital' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const reply = data => json({ data, meta: {} });
let binding, authority, token;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost/api/v2' };
  token = clockToken(); authority = 'synthetic-supplier-current-authority';
  configureV2ApiClient({ getAccessToken: () => token.access_token, getFacilityCode: () => 'HMS', canRefreshSession: () => false });
  const transport = getV2ClientScopeKey(); binding = bindNetworkAccessGuard({ transportScope: transport, authorityScope: authority, principal, readOwnerValue: JSON.stringify(principal) }); activateWriteUncertainty(principal, { authority, transport });
  vi.stubGlobal('fetch', vi.fn(async () => reply(clockNetwork()))); binding.update({ confirmed: true, decision: await networkApi.current() }); fetch.mockReset();
});
afterEach(() => { __resetV2ApiClientForTests(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.__HMS_RUNTIME_CONFIG__ = runtime; });
it.each(['create', 'correct', 'retire', 'reactivate'])('sends actual generated %s with exact action-specific UUID/CAS body and signal', async action => {
  const input = action === 'create' ? creation : action === 'correct' ? correction : { action, client_request_id: requestId, supplier_id: supplierId, expected_version: 1 };
  const previous = { ...supplier, is_active: action !== 'reactivate' }, { command, receipt } = await makeResult(input, previous), abort = new AbortController();
  fetch.mockResolvedValueOnce(reply(receipt)); const result = await inventorySupplierApi.write(command, { signal: abort.signal }); expect(result.receipt).toEqual(receipt);
  const [url, options] = fetch.mock.calls[0], wire = commandWire(command.input); expect(new URL(url).pathname).toBe(wire.path); expect(options.method).toBe('POST'); expect(options.signal).toBe(abort.signal); expect(JSON.parse(options.body)).toEqual(wire.body);
  expect(Object.hasOwn(wire.body, 'action')).toBe(false); expect(Object.hasOwn(wire.body, 'supplier_id')).toBe(false); acknowledgeWriteResponse(result.response); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
it('preserves actual standard metadata and original protected identity for directory/history/bounded metadata reads', async () => {
  const abort = new AbortController(); fetch.mockResolvedValueOnce(json(page([listItem(supplier)])));
  const list = await inventorySupplierApi.list({ search: 'Synthetic & literal', is_active: false, cursor: 'opaque-current', limit: 25 }, { signal: abort.signal });
  expect(list.value).toBe(list.response); assertWriteRecoveryReadCurrent(list.response); expect(() => assertWriteRecoveryReadCurrent({ ...list.response })).toThrow();
  let url = new URL(fetch.mock.calls[0][0]); expect(url.pathname).toBe('/api/v2/inventory/supplier-administration'); expect(Object.fromEntries(url.searchParams)).toEqual({ limit: '25', search: 'Synthetic & literal', is_active: 'false', cursor: 'opaque-current' }); expect(fetch.mock.calls[0][1].signal).toBe(abort.signal);
  fetch.mockResolvedValueOnce(json(page([]))); const history = await inventorySupplierApi.history(supplierId, { cursor: 'opaque-history', limit: 25 }); expect(history.value).toBe(history.response); assertWriteRecoveryReadCurrent(history.response);
  url = new URL(fetch.mock.calls[1][0]); expect(url.pathname).toBe(`/api/v2/inventory/suppliers/${supplierId}/history`); expect(Object.fromEntries(url.searchParams)).toEqual({ limit: '25', cursor: 'opaque-history' });
  fetch.mockResolvedValueOnce(json(page([listItem(otherSupplier)]))); expect((await inventorySupplierApi.list({ is_active: true })).value.data[0].version).toBe(otherSupplier.version);
});
it('reads exact current detail and preserves actual current403 witness after its own clock invalidates', async () => {
  fetch.mockResolvedValueOnce(reply(detail(supplier))); expect((await inventorySupplierApi.get(supplierId)).value.supplier).toEqual(supplier);
  fetch.mockResolvedValueOnce(json({ error: { code: 'forbidden' } }, 403)); const denial = await inventorySupplierApi.get(supplierId).catch(error => error); expect(isCurrentReadDenial(denial)).toBe(true); expect(isCurrentReadDenial({ ...denial })).toBe(false);
});
it('admits lean list and history metadata while refusing contact/address, actor and original snapshot expansion', async () => {
  const row = { id: historyId, action: 'correct', recorded_at: stamp, before_version: 1, after_version: 2, name_changed: false, contact_name_changed: true, phone_changed: false, email_changed: false, address_changed: false, active_changed: false };
  fetch.mockResolvedValueOnce(json(page([row]))); const history = await inventorySupplierApi.history(supplierId); expect(history.value.data).toEqual([row]); expect(history.value).toBe(history.response);
  for (const extra of [{ address: 'PRIVATE-HISTORY-ADDRESS' }, { recorded_by_user_id: actorId }, { before: { address: 'PRIVATE-ORIGINAL-SNAPSHOT' } }, { reason: 'PRIVATE-REASON' }]) {
    fetch.mockResolvedValueOnce(json(page([{ ...row, ...extra }]))); await expect(inventorySupplierApi.history(supplierId)).rejects.toThrow();
  }
  for (const extra of [{ contact_name: 'PRIVATE-DIRECTORY-CONTACT' }, { created_by_user_id: actorId }, { address: 'PRIVATE-DIRECTORY-ADDRESS' }]) {
    fetch.mockResolvedValueOnce(json(page([{ ...listItem(supplier), ...extra }]))); await expect(inventorySupplierApi.list()).rejects.toThrow();
  }
  fetch.mockResolvedValueOnce(reply(detail({ ...supplier, address: 'EXACT-CURRENT-ADDRESS' }))); expect((await inventorySupplierApi.get(supplierId)).value.supplier.address).toBe('EXACT-CURRENT-ADDRESS');
  const { receipt } = await makeResult({ ...correction, address: 'PRIVATE-ORIGINAL-ADDRESS' }); fetch.mockResolvedValueOnce(reply(receipt)); expect((await inventorySupplierApi.original(requestId, actorId)).receipt.supplier.address).toBe('PRIVATE-ORIGINAL-ADDRESS');
});
it('recovers only exact original actor/input/fingerprint proof with separate opaque uncertainty acknowledgment', async () => {
  const { command, receipt } = await makeResult(); fetch.mockRejectedValueOnce(new TypeError('Synthetic lost reply')); const unknown = await inventorySupplierApi.write(command).catch(error => error);
  expect(unknown.name).toBe('InventorySupplierUnconfirmedError'); expect(await inventorySupplierCommandRecoveryCandidate()).toBe(requestId); expect(() => acknowledgeWriteResponse(unknown)).toThrow();
  fetch.mockResolvedValueOnce(reply(receipt)); const original = await inventorySupplierApi.recover(command); expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(true); assertWriteRecoveryReadCurrent(original.response); expect(() => assertWriteRecoveryReadCurrent({ ...original.response })).toThrow();
  acknowledgeWriteResponse(unknown); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
it.each(['directory', 'detail', 'history', 'ordinary-contacts', 'ordinary-item'])('never lets %s reads review an unknown supplier write', async kind => {
  const { command } = await makeResult(); fetch.mockRejectedValueOnce(new TypeError('Synthetic lost')); await inventorySupplierApi.write(command).catch(() => {});
  if (kind === 'directory') { fetch.mockResolvedValueOnce(json(page([listItem(supplier)]))); await inventorySupplierApi.list(); }
  if (kind === 'detail') { fetch.mockResolvedValueOnce(reply(detail(supplier))); await inventorySupplierApi.get(supplierId); }
  if (kind === 'history') { fetch.mockResolvedValueOnce(json(page([]))); await inventorySupplierApi.history(supplierId); }
  if (kind === 'ordinary-contacts') { fetch.mockResolvedValueOnce(json(page([]))); await v2Request({ path: '/api/v2/inventory/suppliers' }); }
  if (kind === 'ordinary-item') { fetch.mockResolvedValueOnce(reply({ id: supplierId })); await v2Request({ path: '/api/v2/inventory/items/{id}', pathParams: { id: supplierId } }); }
  expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(false);
});
it.each(['actor', 'UUID', 'digest', 'input', 'subject', 'version'])('keeps corrupt original %s unreviewed and unknown', async fault => {
  const { command, receipt } = await makeResult(); fetch.mockRejectedValueOnce(new TypeError('Synthetic lost')); await inventorySupplierApi.write(command).catch(() => {});
  if (fault === 'actor') receipt.recorded_by_user_id = otherId;
  if (fault === 'UUID') receipt.client_request_id = otherId;
  if (fault === 'digest') receipt.input_digest = '0'.repeat(64);
  if (fault === 'input') receipt.reviewed_input.reason = 'Other synthetic reason';
  if (fault === 'subject') receipt.supplier.id = otherId;
  if (fault === 'version') receipt.supplier.version++;
  fetch.mockResolvedValueOnce(reply(receipt)); await expect(inventorySupplierApi.recover(command)).rejects.toThrow(); expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(false);
});
it('rejects same-UUID different body fingerprint and permits only explicit identical replay', async () => {
  const { command, receipt } = await makeResult(); fetch.mockRejectedValueOnce(new TypeError('Synthetic lost')); const unknown = await inventorySupplierApi.write(command).catch(error => error);
  const other = await makeResult({ ...correction, reason: 'Another reason' }); fetch.mockResolvedValueOnce(reply(other.receipt)); await v2Request({ path: '/api/v2/inventory/supplier-commands/{client_request_id}', pathParams: { client_request_id: requestId } });
  expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(false); expect(() => acknowledgeWriteResponse(unknown)).toThrow();
  await expect(inventorySupplierApi.write(other.command)).rejects.toMatchObject({ status: 409 }); expect(fetch).toHaveBeenCalledTimes(2);
  fetch.mockResolvedValueOnce(reply(receipt)); await inventorySupplierApi.write(command); expect(fetch).toHaveBeenCalledTimes(3); expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(JSON.parse(fetch.mock.calls[2][1].body));
});
it('keeps definite conflicts definite and marks malformed successful receipts unknown without replay', async () => {
  const { command, receipt } = await makeResult(); fetch.mockResolvedValueOnce(json({ error: { code: 'inventory_supplier_version_conflict' } }, 409)); await expect(inventorySupplierApi.write(command)).rejects.toMatchObject({ status: 409 }); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
  receipt.input_digest = '0'.repeat(64); fetch.mockResolvedValueOnce(reply(receipt)); await expect(inventorySupplierApi.write(command)).rejects.toMatchObject({ name: 'InventorySupplierUnconfirmedError' }); expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(false);
});
it('does not dispatch a canceled operation or copied foreign actor', async () => {
  const { command } = await makeResult(), abort = new AbortController(); abort.abort(); await expect(inventorySupplierApi.write(command, { signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' });
  const copied = await prepareCommand(correction, otherId, supplier); await expect(inventorySupplierApi.write(copied)).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
});
it('reload locates an existing singleton opaque UUID but stores no body and requires explicit separate review acknowledgment', async () => {
  const { command, receipt } = await makeResult({ ...correction, contact_name: 'PRIVATE-CONTACT-SENTINEL', email: 'private@example.invalid', address: 'PRIVATE-ADDRESS-SENTINEL' }); fetch.mockRejectedValueOnce(new TypeError('Synthetic lost')); await inventorySupplierApi.write(command).catch(() => {});
  const stored = sessionStorage.getItem(WRITE_UNCERTAINTY_KEY); expect(stored).not.toContain(correction.reason); expect(stored).not.toContain(correction.name); expect(stored).not.toContain('expected_version');
  expect(stored).not.toContain(command.input.contact_name); expect(stored).not.toContain(command.input.email); expect(stored).not.toContain(command.input.address);
  resetWriteUncertaintyForTests({ preserveStorage: true }); activateWriteUncertainty(principal, { authority, transport: getV2ClientScopeKey() }); await vi.waitFor(() => expect(getWriteUncertaintySnapshot().entries).toHaveLength(1));
  expect(await inventorySupplierCommandRecoveryCandidate()).toBe(requestId); const id = getWriteUncertaintySnapshot().entries[0].id; await expect(acknowledgeWriteReview(id, principal)).rejects.toThrow();
  fetch.mockResolvedValueOnce(reply(receipt)); await inventorySupplierApi.original(requestId, actorId); expect(getWriteUncertaintySnapshot().entries).toHaveLength(1); await acknowledgeWriteReview(id, principal); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
it.each(['denial', 'ABA', 'active-retry', 'changed-uncertainty'])('an original receipt whose digest is pending cannot acknowledge across %s', async transition => {
  const { command, receipt } = await makeResult(); fetch.mockRejectedValueOnce(new TypeError('Synthetic lost')); const unknown = await inventorySupplierApi.write(command).catch(error => error);
  const digest = crypto.subtle.digest.bind(crypto.subtle), expected = JSON.stringify(canonical(command.input)); let release, entered, intercept = true, finishRetry, retry;
  const paused = new Promise(resolve => { release = resolve; }), began = new Promise(resolve => { entered = resolve; });
  const spy = vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (algorithm, bytes) => { if (intercept && new TextDecoder().decode(bytes) === expected) { intercept = false; entered(); await paused; } return digest(algorithm, bytes); });
  try {
    fetch.mockResolvedValueOnce(reply(receipt)); const original = inventorySupplierApi.original(requestId, actorId).catch(error => error); await began;
    if (transition === 'denial') { fetch.mockResolvedValueOnce(json({ error: { code: 'forbidden' } }, 403)); await v2Request({ path: '/api/v2/inventory/suppliers/{id}/administration', pathParams: { id: supplierId } }).catch(() => {}); }
    else if (transition === 'ABA') {
      for (const next of ['synthetic-other-authority', authority]) { const transport = getV2ClientScopeKey(); binding = bindNetworkAccessGuard({ transportScope: transport, authorityScope: next, principal, readOwnerValue: JSON.stringify(principal) }); activateWriteUncertainty(principal, { authority: next, transport }); fetch.mockResolvedValueOnce(reply(clockNetwork())); binding.update({ confirmed: true, decision: await networkApi.current() }); }
    } else if (transition === 'active-retry') { fetch.mockReturnValueOnce(new Promise((_resolve, reject) => { finishRetry = () => reject(new TypeError('Synthetic active retry lost')); })); retry = inventorySupplierApi.write(command).catch(error => error); await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3)); }
    else { fetch.mockRejectedValueOnce(new TypeError('Synthetic new uncertainty')); await inventorySupplierApi.write(command).catch(() => {}); }
    release(); await original; expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(false); expect(() => acknowledgeWriteResponse(unknown)).toThrow();
  } finally { release(); finishRetry?.(); if (retry) await retry; spy.mockRestore(); }
});
it('keeps ambiguous same-family reload candidates unresolved', async () => {
  const { command } = await makeResult(); fetch.mockRejectedValueOnce(new TypeError('Synthetic lost')); await inventorySupplierApi.write(command).catch(() => {});
  const stored = JSON.parse(sessionStorage.getItem(WRITE_UNCERTAINTY_KEY)); stored.entries.push({ ...stored.entries[0], id: crypto.randomUUID(), uuid: crypto.randomUUID(), uncertainty_id: crypto.randomUUID() }); sessionStorage.setItem(WRITE_UNCERTAINTY_KEY, JSON.stringify(stored));
  resetWriteUncertaintyForTests({ preserveStorage: true }); activateWriteUncertainty(principal, { authority, transport: getV2ClientScopeKey() }); await vi.waitFor(() => expect(getWriteUncertaintySnapshot().entries).toHaveLength(2)); expect(await inventorySupplierCommandRecoveryCandidate()).toBeNull();
});
it('refuses unkeyed supplier markers instead of inventing a request UUID', async () => {
  fetch.mockRejectedValueOnce(new TypeError('Synthetic legacy loss')); await v2Request({ method: 'POST', path: '/api/v2/inventory/supplier-administration', body: { code: 'Legacy', name: 'Synthetic legacy' } }).catch(() => {});
  expect(JSON.parse(sessionStorage.getItem(WRITE_UNCERTAINTY_KEY)).entries[0].uuid).toBeNull(); expect(await inventorySupplierCommandRecoveryCandidate()).toBeNull();
});
