// Uses the actual generated client and transport; old SDK is intentionally not
// stubbed. These cases cannot pass until the real compiled nine-op export exists.
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { __resetV2ApiClientForTests, configureV2ApiClient, getV2ClientScopeKey } from '@/lib/api/v2/client';
import { bindNetworkAccessGuard } from '@/lib/api/v2/networkAccessGuard';
import { activateWriteUncertainty, acknowledgeWriteResponse, acknowledgeWriteReview, assertWriteRecoveryReadCurrent, getWriteUncertaintySnapshot, laboratoryCatalogCommandRecoveryCandidate, resetWriteUncertaintyForTests, WRITE_UNCERTAINTY_KEY } from '@/lib/api/v2/writeUncertainty';
import { networkApi } from '@/features/settings/network/api';
import { clockToken, clockNetwork } from '@/features/auth/__tests__/clock-fixtures';
import { laboratoryCatalogApi } from '../api';
import { CATALOG_OPERATIONS, catalogOperations, commandWire } from '../commandWire';
import { actorId, facilityId, otherId, requestId, subject, listItem, page, input, result } from './fixtures';
const runtime = window.__HMS_RUNTIME_CONFIG__, principal = { id: actorId, facility_id: facilityId, active_profile: 'hospital' };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const reply = value => json({ data: value, meta: {} });
let binding, authority;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost/api/v2' };
  const token = clockToken({ ordinary: true }); authority = 'synthetic-current-catalog-authority';
  configureV2ApiClient({ getAccessToken: () => token.access_token, getFacilityCode: () => 'QA27', canRefreshSession: () => false });
  const transport = getV2ClientScopeKey(); binding = bindNetworkAccessGuard({ transportScope: transport, authorityScope: authority, principal, readOwnerValue: JSON.stringify(principal) }); activateWriteUncertainty(principal, { authority, transport });
  vi.stubGlobal('fetch', vi.fn(async () => reply(clockNetwork()))); binding.update({ confirmed: true, decision: await networkApi.current() }); fetch.mockReset();
});
afterEach(() => { __resetV2ApiClientForTests(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.__HMS_RUNTIME_CONFIG__ = runtime; });
it('requires all nine actual compiled operation descriptors, without a fake producer', async () => {
  const operations = await catalogOperations(); expect(CATALOG_OPERATIONS).toHaveLength(9); for (const name of CATALOG_OPERATIONS) expect(operations[name].operationId).toBe(name);
  expect(fetch).not.toHaveBeenCalled();
});
it.each(['test', 'panel'])('sends %s availability only through the actual generated UUID/CAS operation', async kind => {
  const previous = subject(kind), { command, receipt } = await result(input(previous), previous), signal = new AbortController().signal, wire = await commandWire(command.input);
  fetch.mockResolvedValueOnce(reply(receipt)); const confirmed = await laboratoryCatalogApi.write(command, { signal }); expect(confirmed.receipt).toEqual(receipt);
  const [url, options] = fetch.mock.calls[0]; expect(new URL(url).pathname).toBe(wire.path); expect(options.method).toBe('POST'); expect(options.signal).toBe(signal);
  expect(JSON.parse(options.body)).toEqual({ client_request_id: requestId, expected_version: 1, is_active: false, reason: command.input.reason }); acknowledgeWriteResponse(confirmed.response);
});
it.each(['test', 'panel'])('preserves bounded current %s directory/detail/history metadata and AbortSignal', async kind => {
  const previous = subject(kind), signal = new AbortController().signal;
  fetch.mockResolvedValueOnce(json(page([listItem(previous)]))); const directory = await laboratoryCatalogApi.list(kind, { limit: 25, cursor: 'opaque-directory', search: 'Synthetic_% literal', is_active: false, is_system_default: false, is_facility_modified: true, ...(kind === 'test' ? { category: 'Synthetic category' } : {}) }, { signal });
  expect(directory.value).toBe(directory.response); assertWriteRecoveryReadCurrent(directory.response); expect(() => assertWriteRecoveryReadCurrent({ ...directory.response })).toThrow();
  let url = new URL(fetch.mock.calls[0][0]); expect(url.searchParams.get('limit')).toBe('25'); expect(url.searchParams.get('search')).toBe('Synthetic_% literal'); expect(fetch.mock.calls[0][1].signal).toBe(signal);
  fetch.mockResolvedValueOnce(reply(previous)); expect((await laboratoryCatalogApi.get(kind, previous.definition.id, { signal })).value).toEqual(previous);
  fetch.mockResolvedValueOnce(json(page([]))); await laboratoryCatalogApi.history(kind, previous.definition.id, { cursor: 'opaque-history' }, { signal }); url = new URL(fetch.mock.calls[2][0]); expect(url.searchParams.get('cursor')).toBe('opaque-history');
});
it.each([0, 101, 1.1])('refuses invalid directory/history limit %s before transport', async limit => {
  await expect(laboratoryCatalogApi.list('test', { limit })).rejects.toThrow(); await expect(laboratoryCatalogApi.history('test', subject().definition.id, { limit })).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
});
it('keeps explicit machine-code409 unknown while a definite version conflict remains definite', async () => {
  const { command } = await result(); fetch.mockResolvedValueOnce(json({ error: { code: 'laboratory_catalog_version_conflict' } }, 409)); await expect(laboratoryCatalogApi.write(command)).rejects.toMatchObject({ status: 409 }); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
  fetch.mockResolvedValueOnce(json({ error: { code: 'laboratory_catalog_write_unconfirmed' } }, 409)); await expect(laboratoryCatalogApi.write(command)).rejects.toMatchObject({ name: 'CatalogWriteUnconfirmed' }); expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(false); expect(fetch).toHaveBeenCalledTimes(2);
});
it('recovers exact original after later current state with no secondPOST or current-read acknowledgment', async () => {
  const { command, receipt } = await result(); fetch.mockRejectedValueOnce(new TypeError('Synthetic reply lost')); const lost = await laboratoryCatalogApi.write(command).catch(error => error);
  expect(await laboratoryCatalogCommandRecoveryCandidate()).toBe(requestId);
  fetch.mockResolvedValueOnce(reply(subject('test', { version: 5 }))); await laboratoryCatalogApi.get('test', command.input.subject_id); expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(false);
  fetch.mockResolvedValueOnce(json(page([]))); await laboratoryCatalogApi.history('test', command.input.subject_id); expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(false);
  fetch.mockResolvedValueOnce(reply(receipt)); const recovered = await laboratoryCatalogApi.recover(command); assertWriteRecoveryReadCurrent(recovered.response); expect(recovered.receipt.subject.definition.version).toBe(2); acknowledgeWriteResponse(lost); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
  expect(fetch.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1);
});
it('persists only an existing opaque cross-kind UUID and requires separate current receipt acknowledgment after reload', async () => {
  const { command, receipt } = await result(); fetch.mockRejectedValueOnce(new TypeError('Synthetic reply lost')); await laboratoryCatalogApi.write(command).catch(() => {});
  const stored = sessionStorage.getItem(WRITE_UNCERTAINTY_KEY); for (const value of [command.input.reason, command.previous.definition.name, 'expected_version']) expect(stored).not.toContain(value);
  resetWriteUncertaintyForTests({ preserveStorage: true }); activateWriteUncertainty(principal, { authority, transport: getV2ClientScopeKey() }); await vi.waitFor(() => expect(getWriteUncertaintySnapshot().entries).toHaveLength(1)); expect(await laboratoryCatalogCommandRecoveryCandidate()).toBe(requestId);
  const id = getWriteUncertaintySnapshot().entries[0].id; await expect(acknowledgeWriteReview(id, principal)).rejects.toThrow(); fetch.mockResolvedValueOnce(reply(receipt)); await laboratoryCatalogApi.original(requestId, actorId); expect(getWriteUncertaintySnapshot().entries).toHaveLength(1); await acknowledgeWriteReview(id, principal); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
it.each(['actor', 'kind', 'digest'])('rejects corrupt original %s without clearing its unknown barrier', async fault => {
  const { command, receipt } = await result(); fetch.mockRejectedValueOnce(new TypeError('Synthetic lost')); await laboratoryCatalogApi.write(command).catch(() => {});
  if (fault === 'actor') receipt.recorded_by_user_id = otherId; if (fault === 'kind') receipt.subject.kind = 'panel'; if (fault === 'digest') receipt.input_digest = '0'.repeat(64);
  fetch.mockResolvedValueOnce(reply(receipt)); await expect(laboratoryCatalogApi.recover(command)).rejects.toThrow(); expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(false);
});
it('preserves cancellation and prevents a copied foreign actor from dispatching', async () => {
  const { command } = await result(), abort = new AbortController(); abort.abort(); await expect(laboratoryCatalogApi.list('test', {}, { signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' });
  await expect(laboratoryCatalogApi.write({ ...command, actorId: otherId })).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
});
