import { webcrypto } from 'node:crypto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { inventoryApi } from '@/features/inventory/api';
import { __resetV2ApiClientForTests, configureV2ApiClient, getV2ClientScopeKey } from '@/lib/api/v2/client';
import { bindNetworkAccessGuard } from '@/lib/api/v2/networkAccessGuard';
import { acknowledgeWriteResponse, activateWriteUncertainty, getWriteUncertaintySnapshot, WRITE_UNCERTAINTY_KEY } from '@/lib/api/v2/writeUncertainty';
import { useDispenseControlledSubstance, useRecordControlledCount, useRecordControlledWastage } from '../useInventoryQueries';

const item = '70000000-0000-4000-8000-000000000001';
const location = '70000000-0000-4000-8000-000000000002';
const register = '70000000-0000-4000-8000-000000000003';
const witness = '70000000-0000-4000-8000-000000000004';
const principal = { id: '70000000-0000-4000-8000-000000000005', facility_id: '70000000-0000-4000-8000-000000000006', active_profile: 'hospital' };
const movement = { item, location, register, witness, quantity: 1 };
const count = { register, witness, actual_count: 8, category: 'missing', reason: 'SYNTHETIC-PRIVATE-COUNT-REASON' };
const operations = [
  { name: 'dispense', hook: useDispenseControlledSubstance, write: inventoryApi.dispenseControlledSubstance, payload: movement, path: '/pharmacy/controlled-substances/register' },
  { name: 'wastage', hook: useRecordControlledWastage, write: inventoryApi.recordControlledWastage, payload: movement, path: '/pharmacy/controlled-substances/register' },
  { name: 'count', hook: useRecordControlledCount, write: inventoryApi.recordControlledCount, payload: count, path: `/pharmacy/controlled-substances/register/${register}/counts` },
];
const originalFetch = globalThis.fetch;
const originalRuntime = window.__HMS_RUNTIME_CONFIG__;
const clients = [];
const response = (status, code) => new Response(JSON.stringify({ error: { code, message: 'Synthetic controlled stock refusal' } }), { status, headers: { 'content-type': 'application/json' } });

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: 2, retryDelay: 0, gcTime: 0 } } });
  clients.push(client);
  return function Wrapper({ children }) { return <QueryClientProvider client={client}>{children}</QueryClientProvider>; };
}

function activate() {
  const guard = bindNetworkAccessGuard({ transportScope: getV2ClientScopeKey(), authorityScope: 'synthetic-controlled-authority', principal });
  guard.update({ confirmed: true, decision: { access_allowed: true, read_only: false, classification: 'onsite', policy_version: 1 } });
  activateWriteUncertainty(principal);
}

async function reviewCurrentRegister() {
  globalThis.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: register, item_id: item, item_name: 'Synthetic controlled item', location_id: location, location_name: 'Synthetic storage', movement_type: 'dispense', quantity_delta: -1, balance_after: 8, witness_user_id: witness, created_at: '2026-10-17T09:00:00Z' } }), { headers: { 'content-type': 'application/json' } }));
  await inventoryApi.getControlledRegister(register);
  expect(getWriteUncertaintySnapshot().entries[0].reviewed).toBe(true);
}

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' };
  __resetV2ApiClientForTests();
  configureV2ApiClient({ getAccessToken: () => 'synthetic-controlled-token', getFacilityCode: () => 'HMS', canRefreshSession: () => false });
  globalThis.fetch = vi.fn();
});

afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
  __resetV2ApiClientForTests();
  vi.unstubAllGlobals();
  globalThis.fetch = originalFetch;
  window.__HMS_RUNTIME_CONFIG__ = originalRuntime;
});

describe.each(operations)('controlled $name write safety', ({ hook, write, payload, path }) => {
  it.each([
    { name: 'lost response', status: 0, code: 'network_error' },
    { name: 'server failure', status: 503, code: 'controlled_write_unconfirmed' },
    { name: 'definite balance refusal', status: 409, code: 'controlled_balance_review_required' },
  ])('never inherits mutation retries after $name and retains the typed error', async ({ status, code }) => {
    // Exercise the hooks with retries enabled by the app-level QueryClient;
    // safety must not depend on a mounted network boundary or deduplication.
    if (status === 0) globalThis.fetch.mockRejectedValue(new TypeError('Synthetic response lost after server save'));
    else globalThis.fetch.mockImplementation(async () => response(status, code));
    const { result } = renderHook(hook, { wrapper: wrapper() });
    let failure;
    await act(async () => { failure = await result.current.mutateAsync(payload).catch((error) => error); });

    expect(globalThis.fetch).toHaveBeenCalledOnce();
    expect(globalThis.fetch).toHaveBeenCalledWith(`http://localhost:8080/api/v2${path}`, expect.objectContaining({ method: 'POST' }));
    expect(failure).toMatchObject({ name: 'V2ApiError', status });
    if (status !== 0) expect(failure.data.error.code).toBe(code);
  });

  it('preserves the original opaque uncertainty handle on a lost response', async () => {
    activate();
    globalThis.fetch.mockRejectedValueOnce(new TypeError('Synthetic response lost after server save'));
    const failure = await write(payload).catch((error) => error);
    expect(failure).toMatchObject({ name: 'V2ApiError', status: 0 });
    expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
    const stored = sessionStorage.getItem(WRITE_UNCERTAINTY_KEY);
    for (const privateValue of [item, location, register, witness, count.reason, 'synthetic-controlled-token']) expect(stored).not.toContain(privateValue);
    expect(() => acknowledgeWriteResponse(failure)).toThrow();
    await reviewCurrentRegister();
    acknowledgeWriteResponse(failure);
    expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps a generic409 unconfirmed write distinct from a definite balance refusal', async () => {
    activate();
    const code = hook === useRecordControlledCount ? 'controlled_count_write_unconfirmed' : 'controlled_movement_write_unconfirmed';
    globalThis.fetch.mockImplementation(async () => response(409, code));
    const { result } = renderHook(hook, { wrapper: wrapper() });
    let failure;
    await act(async () => { failure = await result.current.mutateAsync(payload).catch((error) => error); });

    expect(globalThis.fetch).toHaveBeenCalledOnce();
    expect(failure).toMatchObject({ name: 'V2ApiError', status: 409, data: { error: { code } } });
    expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
    // An opaque original error alone is insufficient. A current protected
    // workflow read must be reviewed before this exact handle can acknowledge.
    expect(() => acknowledgeWriteResponse(failure)).toThrow();
    await reviewCurrentRegister();
    acknowledgeWriteResponse(failure);
    expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
  });

  it('forwards cancellation and preserves AbortError without retrying', async () => {
    const controller = new AbortController();
    const aborted = new DOMException('Synthetic dispatch aborted', 'AbortError');
    globalThis.fetch.mockRejectedValueOnce(aborted);
    await expect(write(payload, { signal: controller.signal })).rejects.toBe(aborted);
    expect(globalThis.fetch).toHaveBeenCalledOnce();
    expect(globalThis.fetch).toHaveBeenCalledWith(`http://localhost:8080/api/v2${path}`, expect.objectContaining({ signal: controller.signal }));
  });
});

it('does not turn a definite balance refusal into persistent write uncertainty', async () => {
  activate();
  globalThis.fetch.mockResolvedValueOnce(response(409, 'controlled_balance_review_required'));
  await expect(inventoryApi.recordControlledCount(count)).rejects.toMatchObject({ status: 409, data: { error: { code: 'controlled_balance_review_required' } } });
  expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
  expect(globalThis.fetch).toHaveBeenCalledOnce();
});
