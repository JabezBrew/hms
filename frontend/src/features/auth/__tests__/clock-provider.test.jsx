import { webcrypto } from 'node:crypto';
import { useEffect, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '@/lib/auth';
import { queryClient } from '@/lib/react-query';
import { NetworkAccessBoundary } from '@/features/settings/network/NetworkAccessBoundary';
import { __resetV2ApiClientForTests, getV2ClientScopeKey, v2Request } from '@/lib/api/v2/session';
import { useScopedNotifications } from '@/shared/hooks/useScopedNotifications';
import { serverClock } from '@/shared/lib/serverClock';
import { networkClockCurrent } from '@/lib/api/v2/networkAccessGuard';
import { networkKeys } from '@/features/settings/network/keys';
import { networkApi } from '@/features/settings/network/api';
import { clearWorkflowContinuity, getWorkflowContinuity } from '@/shared/lib/workflowContinuity';
import { getWriteUncertaintySnapshot } from '@/lib/api/v2/writeUncertainty';
import { getAuthValue, setAuthValue } from '@/lib/auth-storage';
import { factorApi } from '../api';
import { challengeId, failure, json } from './fixtures';
import { clockNetwork, clockToken, databaseNow, issuerNow } from './clock-fixtures';
// Real provider/generated operations/v2 transport execute; server responses and
// JWT signatures are contract models, not native ceremony or clock acceptance.
const runtime = window.__HMS_RUNTIME_CONFIG__;
let auth, initial, fresh, paths, mounts, network, refreshReply, captureNotice, clinicReply;
function Draft() { captureNotice = useScopedNotifications(); const [text, setText] = useState(''); useEffect(() => { mounts += 1; }, []); return <label>Synthetic local draft<input value={text} onChange={e => setText(e.target.value)} /></label>; }
function Probe() { auth = useAuth(); return <><button onClick={() => auth.login('synthetic@example.test', 'Synthetic password', 'HMS').catch(() => {})}>Start clock session</button>{auth.user && <NetworkAccessBoundary><Draft /></NetworkAccessBoundary>}</>; }
async function mount() { render(<QueryClientProvider client={queryClient}><MemoryRouter><AuthProvider><Probe /></AuthProvider></MemoryRouter></QueryClientProvider>); fireEvent.click(await screen.findByText('Start clock session')); await screen.findByLabelText('Synthetic local draft'); }
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto); localStorage.clear(); sessionStorage.clear(); queryClient.clear(); __resetV2ApiClientForTests(); clearWorkflowContinuity();
  queryClient.setDefaultOptions({ queries: { retry: false, gcTime: 0 }, mutations: { retry: false } });
  window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost/api/v2', defaultFacilityCode: 'HMS' };
  initial = clockToken(); fresh = clockToken({ ordinary: true }); paths = []; mounts = 0; network = () => json(clockNetwork()); clinicReply = () => json([]); refreshReply = () => json(clockToken({ session: '99999999-0000-4000-8000-000000000021' }));
  vi.stubGlobal('fetch', vi.fn(async (url, request = {}) => {
    const path = new URL(url).pathname; paths.push(path);
    if (path.endsWith('/auth/logout')) return json({});
    if (path.endsWith('/auth/login')) return json(initial);
    if (path.endsWith('/auth/reauthenticate')) return json(fresh);
    if (path.endsWith('/auth/network-access')) return network(request);
    if (path.endsWith('/auth/refresh')) return refreshReply(request);
    if (path.endsWith('/auth/assurance/verify')) return json(clockToken({ method: 'passkey' }));
    if (path.endsWith('/clinics')) return clinicReply();
    return failure('synthetic_unavailable', 404);
  }));
});
afterEach(() => { cleanup(); queryClient.clear(); __resetV2ApiClientForTests(); clearWorkflowContinuity(); localStorage.clear(); sessionStorage.clear(); document.cookie = 'hms_v2_csrf=;max-age=0;path=/'; vi.unstubAllGlobals(); vi.restoreAllMocks(); window.__HMS_RUNTIME_CONFIG__ = runtime; });
it.each([86400000, -86400000])('applies current ordinary proof with independent issuer/DB and browser skew=%s', async skew => {
  vi.spyOn(Date, 'now').mockReturnValue(issuerNow + skew); await mount();
  let result; await act(async () => { result = await auth.reauthenticate(auth.user.email, 'Synthetic exact password', 'HMS').catch(e => e); });
  expect(result instanceof Error).toBe(false); expect(auth.getAccessToken()).toBe(fresh.access_token); expect(auth.user).not.toBeNull();
  expect(paths.filter(p => p.endsWith('/auth/reauthenticate'))).toHaveLength(1);
  expect(JSON.parse(getAuthValue('user')).accessContext.auth_security).not.toHaveProperty('auth_clock');
  expect(JSON.stringify(localStorage)).not.toContain('database_observed_at');
});
it('rejects stale own admission even with an advanced revision without reporting THIS confirmation', async () => {
  await mount(); fresh.ordinary_confirmation.admitted_at = new Date(databaseNow - 120000).toISOString(); fresh.ordinary_confirmation.published_password_verified_at = fresh.ordinary_confirmation.admitted_at;
  fresh.access_token = clockToken({ ordinary: true, authTime: issuerNow / 1000 - 60 }).access_token;
  let error; await act(async () => { error = await auth.reauthenticate(auth.user.email, 'Synthetic exact password', 'HMS').catch(e => e); });
  expect(error).toBeInstanceOf(Error); expect(auth.user).toBeNull();
});
it('applies a well-formed concurrent snapshot but reports confirmation-not-confirmed', async () => {
  await mount(); fresh.user.auth_security.assurance_version = 2;
  let error; await act(async () => { error = await auth.reauthenticate(auth.user.email, 'Synthetic exact password', 'HMS').catch(e => e); });
  expect(error).toBeInstanceOf(Error); expect(error.message).toContain('was not confirmed'); expect(auth.getAccessToken()).toBe(fresh.access_token); expect(auth.user).not.toBeNull();
});
it('rejects malformed clock before token application', async () => {
  await mount(); const prior = auth.getAccessToken(); fresh.user.auth_security.auth_clock.access_token_remaining_ms += 1;
  let error; await act(async () => { error = await auth.reauthenticate(auth.user.email, 'Synthetic exact password', 'HMS').catch(e => e); });
  expect(error).toBeInstanceOf(Error); expect(auth.getAccessToken()).toBe(prior); expect(auth.getAccessToken()).not.toBe(fresh.access_token);
});
it('accepts newly created passkey proof from actual verification without comparing browser wall time', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(issuerNow - 86400000); await mount();
  const value = await factorApi.stepUpVerify({ challenge_id: challengeId, credential: {} }); expect(value.status).toBe('authenticated');
});
it('retains local text through exact closed refresh while strict transport scope rotates', async () => {
  await mount(); fireEvent.change(screen.getByLabelText('Synthetic local draft'), { target: { value: 'Unsubmitted synthetic text' } });
  const oldScope = getV2ClientScopeKey(); document.cookie = 'hms_v2_csrf=SYNTHETIC;path=/';
  await act(async () => { await auth.refreshAccessToken(); }); await screen.findByLabelText('Synthetic local draft');
  await waitFor(() => expect(auth.sessionReady).toBe(true));
  expect(getV2ClientScopeKey()).not.toBe(oldScope); expect(mounts).toBe(1); expect(screen.getByLabelText('Synthetic local draft').value).toBe('Unsubmitted synthetic text');
});
it('clears the local instance when refresh changes actual session-local assurance revision', async () => {
  initial = clockToken({ revision: 2 }); await mount(); const oldMounts = mounts;
  document.cookie = 'hms_v2_csrf=SYNTHETIC;path=/'; await act(async () => { await auth.refreshAccessToken(); });
  await screen.findByLabelText('Synthetic local draft'); expect(mounts).toBe(oldMounts + 1);
});
it('conceals a ready workspace during pending refresh and preserves its RAM text', async () => {
  await mount(); fireEvent.change(screen.getByLabelText('Synthetic local draft'), { target: { value: 'Unsubmitted synthetic text' } });
  let release; refreshReply = () => new Promise(resolve => { release = resolve; }); document.cookie = 'hms_v2_csrf=SYNTHETIC;path=/';
  let pending; await act(async () => { pending = auth.refreshAccessToken(); await Promise.resolve(); });
  const input = screen.getByLabelText('Synthetic local draft'); expect(input.closest('[hidden]')).not.toBeNull(); expect(mounts).toBe(1);
  const before = paths.length; await expect(v2Request({ path: '/api/v2/clinics' })).rejects.toMatchObject({ status: 403 }); expect(paths).toHaveLength(before);
  await expect(v2Request({ method: 'POST', path: '/api/v2/admin/org-units', body: { client_request_id: '99999999-0000-4000-8000-000000000022' } })).rejects.toMatchObject({ status: 403 });
  expect(paths).toHaveLength(before); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
  await act(async () => { release(json(clockToken({ session: '99999999-0000-4000-8000-000000000021' }))); await pending; });
  expect(screen.getByLabelText('Synthetic local draft').value).toBe('Unsubmitted synthetic text'); expect(mounts).toBe(1);
});
it('keeps transient refresh failure paused without falsely signing out', async () => {
  await mount(); refreshReply = () => failure('synthetic_unavailable', 503); document.cookie = 'hms_v2_csrf=SYNTHETIC;path=/';
  await act(async () => { await auth.refreshAccessToken(); }); expect(auth.user).not.toBeNull(); expect(auth.sessionReady).toBe(false); expect(auth.getAccessToken()).toBeNull();
});

it.each([0, 86400000])('publishes only a current original scoped lease with browser skew=%s', async skew => {
  vi.spyOn(Date, 'now').mockReturnValue(issuerNow + skew);
  network = () => json({ ...clockNetwork(), classification: 'offsite', mode: 'fresh_reauth', reason: 'offsite_fresh_reauth', reauth_expires_at: new Date(databaseNow + 300000).toISOString() });
  await mount(); const original = captureNotice(); expect(original.isCurrent()).toBe(true);
});

it('restores only after actual refresh, concealing persisted identity and ignoring stale stored server timestamps', async () => {
  await mount(); cleanup(); queryClient.clear();
  setAuthValue('sessionIdleExpiresAt', '2000-01-01T00:00:00Z'); setAuthValue('sessionAbsoluteExpiresAt', '2000-01-01T00:00:00Z');
  document.cookie = 'hms_v2_csrf=SYNTHETIC;path=/'; let finish;
  refreshReply = () => new Promise(resolve => { finish = resolve; });
  render(<QueryClientProvider client={queryClient}><MemoryRouter><AuthProvider><Probe /></AuthProvider></MemoryRouter></QueryClientProvider>);
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  expect(auth.user).toBeNull(); expect(screen.queryByLabelText('Synthetic local draft')).toBeNull();
  await act(async () => { finish(json(clockToken({ session: '99999999-0000-4000-8000-000000000021' }))); });
  await screen.findByLabelText('Synthetic local draft'); expect(auth.sessionReady).toBe(true); expect(auth.getAccessToken()).not.toBeNull();
});

it.each(['none', 'current403', 'binding-denial'])('keeps only current activated network proof across its own transition, later denial=%s', async denial => {
  await mount(); await act(async () => { await auth.reauthenticate(auth.user.email, 'Synthetic current password', 'HMS'); });
  const staged = getWorkflowContinuity().stagedDecision; const tokenClock = serverClock(auth.user.accessContext.auth_security);
  expect(networkClockCurrent(staged)).toBe(true); expect(tokenClock.sessionRemaining()).toBeGreaterThan(0);
  const denied = denial !== 'none';
  if (denial === 'current403') { clinicReply = () => failure('synthetic_current_denial', 403); await expect(v2Request({ path: '/api/v2/clinics' })).rejects.toMatchObject({ status: 403 }); }
  else if (denial === 'binding-denial') { network = () => json({ ...clockNetwork(), classification: 'offsite', mode: 'deny', reason: 'offsite_denied', access_allowed: false, read_only: true }); await act(async () => { await queryClient.invalidateQueries({ queryKey: networkKeys.root }); }); await waitFor(() => expect(networkClockCurrent(staged)).toBe(false)); }
  else await v2Request({ path: '/api/v2/clinics' });
  expect(networkClockCurrent(staged)).toBe(!denied);
  network = () => json(clockNetwork()); const restored = await networkApi.current(); expect(networkClockCurrent(restored)).toBe(true); expect(networkClockCurrent(staged)).toBe(!denied);
  expect(tokenClock.sessionRemaining()).toBeGreaterThan(0);
});

it('clears the retained workspace and publication readiness for an actual facility scope change', async () => {
  await mount(); fireEvent.change(screen.getByLabelText('Synthetic local draft'), { target: { value: 'Unsubmitted synthetic text' } }); const previous = getV2ClientScopeKey();
  await act(async () => { auth.setFacilityCode('OTHER'); });
  expect(getV2ClientScopeKey()).not.toBe(previous); expect(auth.sessionReady).toBe(false); expect(auth.getAccessToken()).toBeNull(); expect(screen.queryByLabelText('Synthetic local draft')).toBeNull();
});

it('invalidates the committed token clock and public getter after provider unmount', async () => {
  await mount(); const prior = auth; const clock = serverClock(auth.user.accessContext.auth_security); expect(clock.sessionRemaining()).toBeGreaterThan(0); cleanup();
  expect(clock.sessionRemaining()).toBe(0); expect(prior.getAccessToken()).toBeNull();
});

it('does not revive a retained staged network clock across actual facility A-to-B-to-A', async () => {
  await mount(); await act(async () => { await auth.reauthenticate(auth.user.email, 'Synthetic current password', 'HMS'); });
  const original = getWorkflowContinuity().stagedDecision; expect(networkClockCurrent(original)).toBe(true);
  await act(async () => { auth.setFacilityCode('OTHER'); }); expect(networkClockCurrent(original)).toBe(false);
  await act(async () => { auth.setFacilityCode('HMS'); }); expect(auth.sessionReady).toBe(false); expect(networkClockCurrent(original)).toBe(false);
  const freshDecision = await networkApi.current(); expect(networkClockCurrent(freshDecision)).toBe(true); expect(networkClockCurrent(original)).toBe(false);
});

it('keeps actual denied-policy copy and does not turn that denial into an expiring allowed grant', async () => {
  await mount(); let deniedReads = 0;
  network = () => { deniedReads += 1; return json({ ...clockNetwork(), classification: 'offsite', mode: 'deny', reason: 'offsite_denied', access_allowed: false, read_only: true }); };
  await act(async () => { await queryClient.invalidateQueries({ queryKey: networkKeys.root }); });
  await waitFor(() => expect(screen.queryByLabelText('Synthetic local draft')).toBeNull());
  expect(screen.getByText('Workflow access is blocked on this network')).toBeInTheDocument();
  expect(screen.queryByText('A fresh sign-in is required')).not.toBeInTheDocument(); expect(deniedReads).toBe(1);
});

it('clears the local workspace when actual closed refresh changes the signed password proof', async () => {
  await mount(); fireEvent.change(screen.getByLabelText('Synthetic local draft'), { target: { value: 'Unsubmitted text under the original password proof' } }); const before = mounts; const originalScope = getV2ClientScopeKey();
  refreshReply = () => json(clockToken({ session: '99999999-0000-4000-8000-000000000021', authTime: issuerNow / 1000 }));
  document.cookie = 'hms_v2_csrf=SYNTHETIC;path=/'; await act(async () => { await auth.refreshAccessToken(); }); await screen.findByLabelText('Synthetic local draft');
  expect(getV2ClientScopeKey()).not.toBe(originalScope); await waitFor(() => expect(mounts).toBe(before + 1)); expect(screen.getByLabelText('Synthetic local draft')).toHaveValue('');
});
