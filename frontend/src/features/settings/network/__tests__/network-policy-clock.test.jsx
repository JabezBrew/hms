import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthContext } from '@/lib/auth/AuthContext';
import { configureV2ApiClient, __resetV2ApiClientForTests, v2Request } from '@/lib/api/v2/session';
import { bindNetworkAccessGuard, networkClockCurrent } from '@/lib/api/v2/networkAccessGuard';
import { useNetworkPolicy } from '../hooks';
import { networkApi } from '../api';
import { networkDecisionDenialPending, useNetworkDecisionExpired } from '../useNetworkDecisionExpired';
import { serverClock } from '@/shared/lib/serverClock';
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
afterEach(() => { cleanup(); vi.useRealTimers(); client.clear(); __resetV2ApiClientForTests(); vi.unstubAllGlobals(); vi.restoreAllMocks(); window.__HMS_RUNTIME_CONFIG__ = runtime; });
async function mount() { render(<AuthContext.Provider value={{ user: networkUser }}><QueryClientProvider client={client}><Probe /></QueryClientProvider></AuthContext.Provider>); await waitFor(() => expect(result.isSuccess).toBe(true)); expect(networkClockCurrent(result.data.current_access)).toBe(true); }
it('preserves the actual new clock when policy current_access changes', async () => {
  await mount(); const first = result.data.current_access; next = () => ({ policy: { ...networkPolicy, version: 4 }, current_access: { ...clockNetwork(), policy_version: 4, read_only: true }, can_update: false });
  let current; await act(async () => { current = (await result.refetch()).data; }); expect(current.current_access).not.toBe(first); expect(current.current_access.read_only).toBe(true); expect(networkClockCurrent(current.current_access)).toBe(true); expect(fetch).toHaveBeenCalledTimes(2);
});
it('keeps a new actual observation when the normalized policy JSON is equal', async () => {
  await mount(); const first = result.data.current_access; next = () => { const value = clockNetwork(); value.auth_clock = { database_observed_at: new Date(databaseNow + 200).toISOString(), issuer_observed_at: new Date(issuerNow + 200).toISOString(), access_token_remaining_ms: 599800 }; return { policy: networkPolicy, current_access: value, can_update: true }; };
  let current; await act(async () => { current = (await result.refetch()).data; }); expect(current.current_access).toEqual(first); expect(current.current_access).not.toBe(first); expect(networkClockCurrent(current.current_access)).toBe(true); expect(fetch).toHaveBeenCalledTimes(2);
});

function ExpiryProbe({ decision }) {
  const expired = useNetworkDecisionExpired(decision);
  return <output aria-label="Observed connection expiry">{!expired ? 'current' : networkDecisionDenialPending(decision) ? 'checking' : 'expired'}</output>;
}
async function deniedMetadataRead() {
  await expect(v2Request({ method: 'GET', path: '/api/v2/system/deployment-capabilities' })).rejects.toMatchObject({ status: 403 });
}
function actualNetworkReplies(changes = {}) {
  fetch.mockImplementation(async url => new URL(url).pathname.endsWith('/auth/network-access')
    ? json({ ...clockNetwork(), ...changes })
    : new Response(JSON.stringify({ error: { code: 'forbidden' } }), { status: 403, headers: { 'content-type': 'application/json' } }));
}
it.each(['credential', 'access token'])('schedules original %s expiry when subscribing after an actual denial', async kind => {
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['Date', 'performance', 'setTimeout', 'clearTimeout'] });
  actualNetworkReplies(kind === 'credential' ? { classification: 'offsite', mode: 'fresh_reauth', reauth_expires_at: new Date(databaseNow + 1000).toISOString() } : {});
  const decision = await networkApi.current(); expect(networkClockCurrent(decision)).toBe(true);
  await deniedMetadataRead(); expect(networkClockCurrent(decision)).toBe(false);
  render(<ExpiryProbe decision={decision} />);
  expect(screen.getByLabelText('Observed connection expiry')).toHaveTextContent('checking');
  await act(async () => vi.advanceTimersByTimeAsync(kind === 'credential' ? 1100 : 600100));
  expect(screen.getByLabelText('Observed connection expiry')).toHaveTextContent('expired');
  expect(networkClockCurrent(decision)).toBe(false);
  expect(fetch.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(0);
});
it.each(['before', 'after'])('does not retain an unactivated observation across neutral guard replacement %s denial', async order => {
  actualNetworkReplies(); const decision = await networkApi.current();
  expect(networkClockCurrent(decision)).toBe(true);
  let binding;
  const replaceGuard = () => { binding = bindNetworkAccessGuard({ transportScope: 'synthetic-same-transport', authorityScope: 'synthetic-replacement-owner', principal: null }); };
  if (order === 'before') replaceGuard();
  await deniedMetadataRead();
  if (order === 'after') replaceGuard();
  render(<ExpiryProbe decision={decision} />);
  expect(screen.getByLabelText('Observed connection expiry')).toHaveTextContent('expired');
  expect(networkClockCurrent(decision)).toBe(false); binding.release();
});
it('preserves staged current-clock semantics across neutral binding while denial never renews or outlives its owner', async () => {
  actualNetworkReplies(); const decision = await networkApi.current(); let ownerCurrent = true;
  // Exercise the existing staged-proof lifecycle with a real response source;
  // no authentication or authority is manufactured by this unit observation.
  serverClock(decision).activate(() => ownerCurrent, { network: true });
  const binding = bindNetworkAccessGuard({ transportScope: 'synthetic-staged-transport', authorityScope: 'synthetic-staged-owner', principal: null });
  expect(networkClockCurrent(decision)).toBe(true);
  render(<ExpiryProbe decision={decision} />);
  expect(screen.getByLabelText('Observed connection expiry')).toHaveTextContent('current');
  await act(async () => deniedMetadataRead());
  expect(screen.getByLabelText('Observed connection expiry')).toHaveTextContent('checking');
  expect(networkClockCurrent(decision)).toBe(false);
  ownerCurrent = false;
  fireEvent(window, new Event('focus'));
  expect(screen.getByLabelText('Observed connection expiry')).toHaveTextContent('expired');
  expect(networkClockCurrent(decision)).toBe(false); binding.release();
});

it('does not treat a null required credential deadline as an unlimited captured budget', async () => {
  actualNetworkReplies({ classification: 'offsite', mode: 'fresh_reauth', reason: 'reauth_required', read_only: true, reauth_required: true, reauth_expires_at: null });
  const decision = await networkApi.current(); expect(networkClockCurrent(decision)).toBe(false);
  render(<ExpiryProbe decision={decision} />);
  expect(screen.getByLabelText('Observed connection expiry')).toHaveTextContent('expired');
  expect(fetch.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(0);
});
