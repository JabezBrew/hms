import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthContext } from '@/lib/auth/AuthContext';
import { configureV2ApiClient, __resetV2ApiClientForTests } from '@/lib/api/v2/session';
import { networkClockCurrent } from '@/lib/api/v2/networkAccessGuard';
import { useNetworkPolicy } from '../hooks';
import { networkPolicy, networkUser } from './fixtures';
import { clockToken, clockNetwork, databaseNow, issuerNow } from '@/features/auth/__tests__/clock-fixtures';
import { json } from '@/features/auth/__tests__/fixtures';
// Actual generated admin GET + typed clock adapter + TanStack Query. HTTP/JWT
// signatures are modeled; no clock-model helper or reconstructed proof is used.
const runtime = window.__HMS_RUNTIME_CONFIG__; let client, result, next;
function Probe() { result = useNetworkPolicy(true); return null; }
beforeEach(() => {
  __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost/api/v2' }; const token = clockToken().access_token;
  configureV2ApiClient({ getAccessToken: () => token, getFacilityCode: () => 'HMS', canRefreshSession: () => false }); client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); next = () => ({ policy: networkPolicy, current_access: clockNetwork(), can_update: true });
  vi.stubGlobal('fetch', vi.fn(async () => json(next())));
});
afterEach(() => { cleanup(); client.clear(); __resetV2ApiClientForTests(); vi.unstubAllGlobals(); vi.restoreAllMocks(); window.__HMS_RUNTIME_CONFIG__ = runtime; });
async function mount() { render(<AuthContext.Provider value={{ user: networkUser }}><QueryClientProvider client={client}><Probe /></QueryClientProvider></AuthContext.Provider>); await waitFor(() => expect(result.isSuccess).toBe(true)); expect(networkClockCurrent(result.data.current_access)).toBe(true); }
it('preserves the actual new clock when policy current_access changes', async () => {
  await mount(); const first = result.data.current_access; next = () => ({ policy: { ...networkPolicy, version: 4 }, current_access: { ...clockNetwork(), policy_version: 4, read_only: true }, can_update: false });
  let current; await act(async () => { current = (await result.refetch()).data; }); expect(current.current_access).not.toBe(first); expect(current.current_access.read_only).toBe(true); expect(networkClockCurrent(current.current_access)).toBe(true); expect(fetch).toHaveBeenCalledTimes(2);
});
it('keeps a new actual observation when the normalized policy JSON is equal', async () => {
  await mount(); const first = result.data.current_access; next = () => { const value = clockNetwork(); value.auth_clock = { database_observed_at: new Date(databaseNow + 200).toISOString(), issuer_observed_at: new Date(issuerNow + 200).toISOString(), access_token_remaining_ms: 599800 }; return { policy: networkPolicy, current_access: value, can_update: true }; };
  let current; await act(async () => { current = (await result.refetch()).data; }); expect(current.current_access).toEqual(first); expect(current.current_access).not.toBe(first); expect(networkClockCurrent(current.current_access)).toBe(true); expect(fetch).toHaveBeenCalledTimes(2);
});
