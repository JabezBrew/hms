import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { __resetV2ApiClientForTests, configureV2ApiClient, getV2ClientScopeKey, v2Request } from '@/lib/api/v2/client';
import { bindNetworkAccessGuard } from '@/lib/api/v2/networkAccessGuard';
import { activateWriteUncertainty, acknowledgeWriteResponse, acknowledgeWriteReview, assertWriteRecoveryReadCurrent, getWriteUncertaintySnapshot, inventoryCategoryCommandRecoveryCandidate, resetWriteUncertaintyForTests, WRITE_UNCERTAINTY_KEY } from '@/lib/api/v2/writeUncertainty';
import { isCurrentReadDenial } from '@/lib/api/v2/readDenials';
import { networkApi } from '@/features/settings/network/api';
import { clockToken, clockNetwork } from '@/features/auth/__tests__/clock-fixtures';
import { inventoryCategoryApi } from '../api';
import { commandWire } from '../commandWire';
import { confirmParent, confirmParentDetail } from '../parentSelection';
import { canonical, prepareCommand } from '../model';
import { actorId, category, categoryId, correction, creation, detail, historyId, listItem, page, parent, parentId, requestId, makeResult, stamp } from './fixtures';
const runtime = window.__HMS_RUNTIME_CONFIG__, principal = { id: actorId, facility_id: parentId, active_profile: 'hospital' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const reply = data => json({ data, meta: {} });
let binding, authority, token;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost/api/v2' };
  token = clockToken(); authority = 'synthetic-category-current-authority';
  configureV2ApiClient({ getAccessToken: () => token.access_token, getFacilityCode: () => 'HMS', canRefreshSession: () => false });
  const transport = getV2ClientScopeKey(); binding = bindNetworkAccessGuard({ transportScope: transport, authorityScope: authority, principal, readOwnerValue: JSON.stringify(principal) }); activateWriteUncertainty(principal, { authority, transport });
  vi.stubGlobal('fetch', vi.fn(async () => reply(clockNetwork()))); binding.update({ confirmed: true, decision: await networkApi.current() }); fetch.mockReset();
});
afterEach(() => { __resetV2ApiClientForTests(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.__HMS_RUNTIME_CONFIG__ = runtime; });
it.each(['create', 'correct', 'retire', 'reactivate'])('sends actual generated %s with exact action-specific UUID/CAS body and signal', async action => {
  const input = action === 'create' ? creation : action === 'correct' ? correction : { action, client_request_id: requestId, category_id: categoryId, expected_version: 1 };
  const previous = { ...category, is_active: action !== 'reactivate' }, { command, receipt } = await makeResult(input, previous), abort = new AbortController();
  fetch.mockResolvedValueOnce(reply(receipt)); const result = await inventoryCategoryApi.write(command, { signal: abort.signal }); expect(result.receipt).toEqual(receipt);
  const [url, options] = fetch.mock.calls[0], wire = commandWire(command.input); expect(new URL(url).pathname).toBe(wire.path); expect(options.method).toBe('POST'); expect(options.signal).toBe(abort.signal); expect(JSON.parse(options.body)).toEqual(wire.body);
  expect(Object.hasOwn(wire.body, 'action')).toBe(false); expect(Object.hasOwn(wire.body, 'category_id')).toBe(false); acknowledgeWriteResponse(result.response); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
it('preserves actual standard metadata and original protected identity for directory/history/management-parent reads', async () => {
  const abort = new AbortController(); fetch.mockResolvedValueOnce(json(page([listItem(category)])));
  const list = await inventoryCategoryApi.list({ search: 'Synthetic & literal', is_active: false, cursor: 'opaque-current', limit: 25 }, { signal: abort.signal });
  expect(list.value).toBe(list.response); assertWriteRecoveryReadCurrent(list.response); expect(() => assertWriteRecoveryReadCurrent({ ...list.response })).toThrow();
  let url = new URL(fetch.mock.calls[0][0]); expect(url.pathname).toBe('/api/v2/inventory/category-administration'); expect(Object.fromEntries(url.searchParams)).toEqual({ limit: '25', search: 'Synthetic & literal', is_active: 'false', cursor: 'opaque-current' }); expect(fetch.mock.calls[0][1].signal).toBe(abort.signal);
  fetch.mockResolvedValueOnce(json(page([]))); const history = await inventoryCategoryApi.history(categoryId, { cursor: 'opaque-history', limit: 25 }); expect(history.value).toBe(history.response); assertWriteRecoveryReadCurrent(history.response);
  url = new URL(fetch.mock.calls[1][0]); expect(url.pathname).toBe(`/api/v2/inventory/categories/${categoryId}/history`); expect(Object.fromEntries(url.searchParams)).toEqual({ limit: '25', cursor: 'opaque-history' });
  fetch.mockResolvedValueOnce(json(page([listItem(parent)]))); expect((await inventoryCategoryApi.list({ is_active: true })).value.data[0].version).toBe(parent.version);
});
it('reads exact current detail and preserves actual current403 witness after its own clock invalidates', async () => {
  fetch.mockResolvedValueOnce(reply(detail(category))); expect((await inventoryCategoryApi.get(categoryId)).value.category).toEqual(category);
  fetch.mockResolvedValueOnce(json({ error: { code: 'forbidden' } }, 403)); const denial = await inventoryCategoryApi.get(categoryId).catch(error => error); expect(isCurrentReadDenial(denial)).toBe(true); expect(isCurrentReadDenial({ ...denial })).toBe(false);
});
it('requires original protected parent page/detail identity in addition to copied selection values', async () => {
  fetch.mockResolvedValueOnce(json(page([listItem(parent)]))); const candidates = await inventoryCategoryApi.list({ is_active: true });
  fetch.mockResolvedValueOnce(reply(detail(parent))); const selectedDetail = await inventoryCategoryApi.get(parentId);
  const selection = { row: structuredClone(candidates.value.data[0]), response: candidates.response, lease: { isCurrent: () => true }, isCurrent: () => true };
  expect(confirmParentDetail(selection, selectedDetail)).toEqual({ parent_id: parentId, expected_parent_version: 1 });
  expect(() => confirmParent({ ...selection, response: { ...selection.response } })).toThrow(); expect(() => confirmParentDetail(selection, { ...selectedDetail, response: { ...selectedDetail.response } })).toThrow();
  expect(() => confirmParent({ ...selection, isCurrent: () => false })).toThrow(); expect(() => confirmParent({ ...selection, row: { ...selection.row, version: 2 } })).toThrow();
});
it('admits lean list and history metadata while refusing private description, actor and original snapshot expansion', async () => {
  const row = { id: historyId, action: 'correct', recorded_at: stamp, before_version: 1, after_version: 2, name_changed: false, description_changed: true, parent_changed: false, active_changed: false };
  fetch.mockResolvedValueOnce(json(page([row]))); const history = await inventoryCategoryApi.history(categoryId); expect(history.value.data).toEqual([row]); expect(history.value).toBe(history.response);
  for (const extra of [{ description: 'PRIVATE-HISTORY-DESCRIPTION' }, { recorded_by_user_id: actorId }, { before: { description: 'PRIVATE-ORIGINAL-SNAPSHOT' } }, { reason: 'PRIVATE-REASON' }]) {
    fetch.mockResolvedValueOnce(json(page([{ ...row, ...extra }]))); await expect(inventoryCategoryApi.history(categoryId)).rejects.toThrow();
  }
  for (const extra of [{ description: 'PRIVATE-DIRECTORY-DESCRIPTION' }, { created_by_user_id: actorId }, { parent: { name: 'UNREVIEWED-PARENT' } }]) {
    fetch.mockResolvedValueOnce(json(page([{ ...listItem(category), ...extra }]))); await expect(inventoryCategoryApi.list()).rejects.toThrow();
  }
  fetch.mockResolvedValueOnce(reply(detail({ ...category, description: 'EXACT-CURRENT-DESCRIPTION' }))); expect((await inventoryCategoryApi.get(categoryId)).value.category.description).toBe('EXACT-CURRENT-DESCRIPTION');
  const { receipt } = await makeResult({ ...correction, description: 'PRIVATE-ORIGINAL-DESCRIPTION' }); fetch.mockResolvedValueOnce(reply(receipt)); expect((await inventoryCategoryApi.original(requestId, actorId)).receipt.category.description).toBe('PRIVATE-ORIGINAL-DESCRIPTION');
});
it('recovers only exact original actor/input/fingerprint proof with separate opaque uncertainty acknowledgment', async () => {
  const { command, receipt } = await makeResult(); fetch.mockRejectedValueOnce(new TypeError('Synthetic lost reply')); const unknown = await inventoryCategoryApi.write(command).catch(error => error);
  expect(unknown.name).toBe('InventoryCategoryUnconfirmedError'); expect(await inventoryCategoryCommandRecoveryCandidate()).toBe(requestId); expect(() => acknowledgeWriteResponse(unknown)).toThrow();
  fetch.mockResolvedValueOnce(reply(receipt)); const original = await inventoryCategoryApi.recover(command); expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(true); assertWriteRecoveryReadCurrent(original.response); expect(() => assertWriteRecoveryReadCurrent({ ...original.response })).toThrow();
  acknowledgeWriteResponse(unknown); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
it.each(['directory', 'detail', 'history', 'parent', 'item-picker', 'ordinary-item'])('never lets %s reads review an unknown category write', async kind => {
  const { command } = await makeResult(); fetch.mockRejectedValueOnce(new TypeError('Synthetic lost')); await inventoryCategoryApi.write(command).catch(() => {});
  if (kind === 'directory') { fetch.mockResolvedValueOnce(json(page([listItem(category)]))); await inventoryCategoryApi.list(); }
  if (kind === 'detail') { fetch.mockResolvedValueOnce(reply(detail(category))); await inventoryCategoryApi.get(categoryId); }
  if (kind === 'history') { fetch.mockResolvedValueOnce(json(page([]))); await inventoryCategoryApi.history(categoryId); }
  if (kind === 'parent') { fetch.mockResolvedValueOnce(reply(detail(parent))); await inventoryCategoryApi.get(parentId); }
  if (kind === 'item-picker') { fetch.mockResolvedValueOnce(json(page([{ id: categoryId, code: category.code, name: category.name }]))); await v2Request({ path: '/api/v2/inventory/categories' }); }
  if (kind === 'ordinary-item') { fetch.mockResolvedValueOnce(reply({ id: categoryId })); await v2Request({ path: '/api/v2/inventory/items/{id}', pathParams: { id: categoryId } }); }
  expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(false);
});
it.each(['actor', 'UUID', 'digest', 'input', 'subject', 'version'])('keeps corrupt original %s unreviewed and unknown', async fault => {
  const { command, receipt } = await makeResult(); fetch.mockRejectedValueOnce(new TypeError('Synthetic lost')); await inventoryCategoryApi.write(command).catch(() => {});
  if (fault === 'actor') receipt.recorded_by_user_id = parentId;
  if (fault === 'UUID') receipt.client_request_id = parentId;
  if (fault === 'digest') receipt.input_digest = '0'.repeat(64);
  if (fault === 'input') receipt.reviewed_input.reason = 'Other synthetic reason';
  if (fault === 'subject') receipt.category.id = parentId;
  if (fault === 'version') receipt.category.version++;
  fetch.mockResolvedValueOnce(reply(receipt)); await expect(inventoryCategoryApi.recover(command)).rejects.toThrow(); expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(false);
});
it('rejects same-UUID different body fingerprint and permits only explicit identical replay', async () => {
  const { command, receipt } = await makeResult(); fetch.mockRejectedValueOnce(new TypeError('Synthetic lost')); const unknown = await inventoryCategoryApi.write(command).catch(error => error);
  const other = await makeResult({ ...correction, reason: 'Another reason' }); fetch.mockResolvedValueOnce(reply(other.receipt)); await v2Request({ path: '/api/v2/inventory/category-commands/{client_request_id}', pathParams: { client_request_id: requestId } });
  expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(false); expect(() => acknowledgeWriteResponse(unknown)).toThrow();
  await expect(inventoryCategoryApi.write(other.command)).rejects.toMatchObject({ status: 409 }); expect(fetch).toHaveBeenCalledTimes(2);
  fetch.mockResolvedValueOnce(reply(receipt)); await inventoryCategoryApi.write(command); expect(fetch).toHaveBeenCalledTimes(3); expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(JSON.parse(fetch.mock.calls[2][1].body));
});
it('keeps definite conflicts definite and marks malformed successful receipts unknown without replay', async () => {
  const { command, receipt } = await makeResult(); fetch.mockResolvedValueOnce(json({ error: { code: 'inventory_category_version_conflict' } }, 409)); await expect(inventoryCategoryApi.write(command)).rejects.toMatchObject({ status: 409 }); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
  receipt.input_digest = '0'.repeat(64); fetch.mockResolvedValueOnce(reply(receipt)); await expect(inventoryCategoryApi.write(command)).rejects.toMatchObject({ name: 'InventoryCategoryUnconfirmedError' }); expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(false);
});
it('does not dispatch a canceled operation or copied foreign actor', async () => {
  const { command } = await makeResult(), abort = new AbortController(); abort.abort(); await expect(inventoryCategoryApi.write(command, { signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' });
  const copied = await prepareCommand(correction, parentId, category); await expect(inventoryCategoryApi.write(copied)).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
});
it('reload locates an existing singleton opaque UUID but stores no body and requires explicit separate review acknowledgment', async () => {
  const { command, receipt } = await makeResult(); fetch.mockRejectedValueOnce(new TypeError('Synthetic lost')); await inventoryCategoryApi.write(command).catch(() => {});
  const stored = sessionStorage.getItem(WRITE_UNCERTAINTY_KEY); expect(stored).not.toContain(correction.reason); expect(stored).not.toContain(correction.name); expect(stored).not.toContain('expected_version');
  resetWriteUncertaintyForTests({ preserveStorage: true }); activateWriteUncertainty(principal, { authority, transport: getV2ClientScopeKey() }); await vi.waitFor(() => expect(getWriteUncertaintySnapshot().entries).toHaveLength(1));
  expect(await inventoryCategoryCommandRecoveryCandidate()).toBe(requestId); const id = getWriteUncertaintySnapshot().entries[0].id; await expect(acknowledgeWriteReview(id, principal)).rejects.toThrow();
  fetch.mockResolvedValueOnce(reply(receipt)); await inventoryCategoryApi.original(requestId, actorId); expect(getWriteUncertaintySnapshot().entries).toHaveLength(1); await acknowledgeWriteReview(id, principal); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
it.each(['denial', 'ABA', 'active-retry', 'changed-uncertainty'])('an original receipt whose digest is pending cannot acknowledge across %s', async transition => {
  const { command, receipt } = await makeResult(); fetch.mockRejectedValueOnce(new TypeError('Synthetic lost')); const unknown = await inventoryCategoryApi.write(command).catch(error => error);
  const digest = crypto.subtle.digest.bind(crypto.subtle), expected = JSON.stringify(canonical(command.input)); let release, entered, intercept = true, finishRetry, retry;
  const paused = new Promise(resolve => { release = resolve; }), began = new Promise(resolve => { entered = resolve; });
  const spy = vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (algorithm, bytes) => { if (intercept && new TextDecoder().decode(bytes) === expected) { intercept = false; entered(); await paused; } return digest(algorithm, bytes); });
  try {
    fetch.mockResolvedValueOnce(reply(receipt)); const original = inventoryCategoryApi.original(requestId, actorId).catch(error => error); await began;
    if (transition === 'denial') { fetch.mockResolvedValueOnce(json({ error: { code: 'forbidden' } }, 403)); await v2Request({ path: '/api/v2/inventory/categories/{id}/administration', pathParams: { id: categoryId } }).catch(() => {}); }
    else if (transition === 'ABA') {
      for (const next of ['synthetic-other-authority', authority]) { const transport = getV2ClientScopeKey(); binding = bindNetworkAccessGuard({ transportScope: transport, authorityScope: next, principal, readOwnerValue: JSON.stringify(principal) }); activateWriteUncertainty(principal, { authority: next, transport }); fetch.mockResolvedValueOnce(reply(clockNetwork())); binding.update({ confirmed: true, decision: await networkApi.current() }); }
    } else if (transition === 'active-retry') { fetch.mockReturnValueOnce(new Promise((_resolve, reject) => { finishRetry = () => reject(new TypeError('Synthetic active retry lost')); })); retry = inventoryCategoryApi.write(command).catch(error => error); await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3)); }
    else { fetch.mockRejectedValueOnce(new TypeError('Synthetic new uncertainty')); await inventoryCategoryApi.write(command).catch(() => {}); }
    release(); await original; expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(false); expect(() => acknowledgeWriteResponse(unknown)).toThrow();
  } finally { release(); finishRetry?.(); if (retry) await retry; spy.mockRestore(); }
});
it('keeps ambiguous same-family reload candidates unresolved', async () => {
  const { command } = await makeResult(); fetch.mockRejectedValueOnce(new TypeError('Synthetic lost')); await inventoryCategoryApi.write(command).catch(() => {});
  const stored = JSON.parse(sessionStorage.getItem(WRITE_UNCERTAINTY_KEY)); stored.entries.push({ ...stored.entries[0], id: crypto.randomUUID(), uuid: crypto.randomUUID(), uncertainty_id: crypto.randomUUID() }); sessionStorage.setItem(WRITE_UNCERTAINTY_KEY, JSON.stringify(stored));
  resetWriteUncertaintyForTests({ preserveStorage: true }); activateWriteUncertainty(principal, { authority, transport: getV2ClientScopeKey() }); await vi.waitFor(() => expect(getWriteUncertaintySnapshot().entries).toHaveLength(2)); expect(await inventoryCategoryCommandRecoveryCandidate()).toBeNull();
});
it('refuses unkeyed category markers instead of inventing a request UUID', async () => {
  fetch.mockRejectedValueOnce(new TypeError('Synthetic legacy loss')); await v2Request({ method: 'POST', path: '/api/v2/inventory/category-administration', body: { code: 'Legacy', name: 'Synthetic legacy' } }).catch(() => {});
  expect(JSON.parse(sessionStorage.getItem(WRITE_UNCERTAINTY_KEY)).entries[0].uuid).toBeNull(); expect(await inventoryCategoryCommandRecoveryCandidate()).toBeNull();
});
