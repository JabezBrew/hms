import { webcrypto } from 'node:crypto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '@/lib/auth';
import { queryClient } from '@/lib/react-query';
import { NetworkAccessBoundary } from '@/features/settings/network/NetworkAccessBoundary';
import { networkKeys } from '@/features/settings/network/keys';
import { __resetV2ApiClientForTests } from '@/lib/api/v2/session';
import { acknowledgeWriteResponse, acknowledgeWriteReview, getWriteUncertaintySnapshot } from '@/lib/api/v2/writeUncertainty';
import { networkClockCurrent, currentNetworkPrincipal } from '@/lib/api/v2/networkAccessGuard';
import { useScopedNotifications } from '@/shared/hooks/useScopedNotifications';
import { storageLocationApi } from '@/features/inventory/locations/api';
import { inputDigest, prepareCommand } from '@/features/inventory/locations/model';
import { location, locationId, requestId } from '@/features/inventory/locations/__tests__/fixtures';
import { clearWorkflowContinuity } from '@/shared/lib/workflowContinuity';
import { json, failure, jwtFor } from './fixtures';
import { clockToken, clockNetwork, issuerNow, databaseNow } from './clock-fixtures';
const runtime = window.__HMS_RUNTIME_CONFIG__;
let auth, initial, network, refreshReply, receipt, command, retained, captureNotice;
function Child() { captureNotice = useScopedNotifications(); return <p>Synthetic receipt workspace</p>; }
function Probe() { auth = useAuth(); return <><button onClick={() => auth.login('synthetic@example.test', 'Synthetic password', 'HMS').catch(() => {})}>Start receipt clock session</button>{auth.user && <NetworkAccessBoundary><Child /></NetworkAccessBoundary>}</>; }
async function mount() { render(<QueryClientProvider client={queryClient}><MemoryRouter><AuthProvider><Probe /></AuthProvider></MemoryRouter></QueryClientProvider>); fireEvent.click(await screen.findByText('Start receipt clock session')); await screen.findByText('Synthetic receipt workspace'); }
async function read() { const result = await storageLocationApi.recover(command); expect(result.client_request_id).toBe(requestId); expect(getWriteUncertaintySnapshot().entries[0]?.reviewed).toBe(true); }
async function unknown() { retained = await storageLocationApi.write(command).catch(e => e); expect(retained.name).toBe('StorageLocationUnconfirmedError'); await read(); }
const acknowledge = kind => kind === 'global' ? acknowledgeWriteReview(getWriteUncertaintySnapshot().entries[0].id, currentNetworkPrincipal()) : Promise.resolve().then(() => acknowledgeWriteResponse(retained));
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); localStorage.clear(); sessionStorage.clear(); queryClient.clear(); __resetV2ApiClientForTests(); clearWorkflowContinuity();
  queryClient.setDefaultOptions({ queries: { retry: false, gcTime: 0 }, mutations: { retry: false } }); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost/api/v2', defaultFacilityCode: 'HMS' };
  initial = clockToken(); initial.user.permissions = ['inventory.view', 'inventory.manage', 'patient.demographics.view']; initial.user.features = ['inventory'];
  const input = { action: 'rename', location_id: locationId, client_request_id: requestId, expected_version: 1, name: 'Synthetic corrected location' }; command = await prepareCommand(input, initial.user.id, location);
  receipt = { client_request_id: requestId, input_digest: await inputDigest(input), reviewed_input: input, recorded_by_user_id: initial.user.id, location: { ...location, name: input.name, version: 2 }, changed: true, recorded_at: location.updated_at };
  network = () => json(clockNetwork()); refreshReply = () => json(clockToken({ session: '99999999-0000-4000-8000-000000000021' }));
  vi.stubGlobal('fetch', vi.fn(async url => {
    const path = new URL(url).pathname;
    if (path.endsWith('/auth/logout')) return json({}); if (path.endsWith('/auth/login')) return json(initial); if (path.endsWith('/auth/network-access')) return network(); if (path.endsWith('/auth/refresh')) return refreshReply();
    if (path.endsWith('/rename')) throw new TypeError('Synthetic lost original result'); if (path.includes('/storage-locations/commands/')) return json(receipt); return failure('synthetic_unavailable', 404);
  }));
});
afterEach(() => { cleanup(); queryClient.clear(); __resetV2ApiClientForTests(); clearWorkflowContinuity(); localStorage.clear(); sessionStorage.clear(); document.cookie = 'hms_v2_csrf=;max-age=0;path=/'; vi.unstubAllGlobals(); vi.restoreAllMocks(); window.__HMS_RUNTIME_CONFIG__ = runtime; });
it.each(['global', 'retained'])('keeps a reviewed receipt blocked while session checking and requires fresh %s review afterward', async kind => {
  await mount(); await unknown(); const originalNotice = captureNotice(); let finish; refreshReply = () => new Promise(resolve => { finish = resolve; }); document.cookie = 'hms_v2_csrf=SYNTHETIC;path=/';
  let pending; await act(async () => { pending = auth.refreshAccessToken(); await Promise.resolve(); }); await waitFor(() => expect(finish).toBeTypeOf('function'));
  expect(auth.sessionReady).toBe(false); await expect(acknowledge(kind)).rejects.toMatchObject({ status: 409 }); expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
  const refreshed = clockToken({ session: '99999999-0000-4000-8000-000000000021' }); refreshed.user.permissions = initial.user.permissions; refreshed.user.features = initial.user.features;
  await act(async () => { finish(json(refreshed)); await pending; }); await screen.findByText('Synthetic receipt workspace');
  expect(originalNotice.isCurrent()).toBe(false); expect(captureNotice().isCurrent()).toBe(true);
  await expect(acknowledge(kind)).rejects.toMatchObject({ status: 409 }); await read(); await acknowledge(kind); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
it.each(['global', 'retained'])('cannot revive an old %s receipt lease when a fresh same-scope network budget returns', async kind => {
  let elapsed = 0; const base = performance.now(); vi.spyOn(performance, 'now').mockImplementation(() => base + elapsed); let first = true;
  network = () => {
    if (first) { elapsed += 600; first = false; }
    const value = clockNetwork(); value.classification = 'offsite'; value.mode = 'fresh_reauth'; value.reason = 'offsite_fresh_reauth'; value.reauth_expires_at = new Date(databaseNow + 1600).toISOString();
    value.auth_clock = { database_observed_at: new Date(databaseNow + elapsed).toISOString(), issuer_observed_at: new Date(issuerNow + elapsed).toISOString(), access_token_remaining_ms: 600000 - elapsed };
    return json(value);
  };
  await mount(); await unknown(); const originalNotice = captureNotice(); expect(originalNotice.isCurrent()).toBe(true); elapsed += 500; expect(originalNotice.isCurrent()).toBe(false);
  await expect(acknowledge(kind)).rejects.toMatchObject({ status: 409 });
  await act(async () => { await queryClient.invalidateQueries({ queryKey: networkKeys.root }); }); await screen.findByText('Synthetic receipt workspace');
  expect(originalNotice.isCurrent()).toBe(false); expect(captureNotice().isCurrent()).toBe(true);
  await expect(acknowledge(kind)).rejects.toMatchObject({ status: 409 }); expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
  await read(); await acknowledge(kind); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});

it.each(['global', 'retained'])('expires the ORIGINAL issued session budget before a newer network budget and refuses %s acknowledgment', async kind => {
  let elapsed = 0; const base = performance.now(); vi.spyOn(performance, 'now').mockImplementation(() => base + elapsed);
  const observed = value => {
    const seconds = Math.floor((issuerNow + elapsed) / 1000);
    value.auth_clock = { database_observed_at: new Date(databaseNow + elapsed).toISOString(), issuer_observed_at: new Date(issuerNow + elapsed).toISOString(), access_token_remaining_ms: (seconds + 600) * 1000 - issuerNow - elapsed };
    return value;
  };
  // The login response is sampled at the end of a modeled 600ms roundtrip.
  // Its conservative dispatch-aged budget must expire before the subsequent
  // zero-roundtrip current-network observation for the same signed token.
  const loginFetch = fetch.getMockImplementation();
  fetch.mockImplementation(async (url, request) => {
    if (new URL(url).pathname.endsWith('/auth/login')) { elapsed = 600; const clock = observed({}).auth_clock; initial.user.auth_security.auth_clock = clock; return json(initial); }
    return loginFetch(url, request);
  });
  network = () => { const value = clockNetwork(); value.auth_clock = { database_observed_at: new Date(databaseNow + elapsed).toISOString(), issuer_observed_at: new Date(issuerNow + elapsed).toISOString(), access_token_remaining_ms: 600000 - elapsed }; return json(value); };
  await mount(); await unknown(); const originalNotice = captureNotice(); const originalDecision = queryClient.getQueriesData({ queryKey: networkKeys.root }).find(([, value]) => value?.access_allowed)?.[1];
  expect(auth.getSessionBudget().remaining).toBeGreaterThan(0); elapsed = 599500;
  expect(auth.getSessionBudget().remaining).toBe(0); expect(auth.getAccessToken()).toBeNull();
  expect(originalDecision).toBeDefined(); expect(networkClockCurrent(originalDecision)).toBe(true);
  await expect(acknowledge(kind)).rejects.toMatchObject({ status: 409 }); expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
  document.cookie = 'hms_v2_csrf=SYNTHETIC;path=/';
  refreshReply = () => { const reply = clockToken({ session: '99999999-0000-4000-8000-000000000021' }); reply.user.permissions = initial.user.permissions; reply.user.features = initial.user.features;
    const seconds = Math.floor((issuerNow + elapsed) / 1000); reply.access_token = jwtFor(reply, { iat: seconds, exp: seconds + 600, auth_time: issuerNow / 1000 - 120, session_id: '99999999-0000-4000-8000-000000000021' }); reply.user.auth_security.auth_clock = observed({}).auth_clock; return json(reply); };
  network = () => json(observed(clockNetwork()));
  await act(async () => { await auth.refreshAccessToken(); }); await screen.findByText('Synthetic receipt workspace');
  expect(auth.getSessionBudget().remaining).toBeGreaterThan(0); expect(originalNotice.isCurrent()).toBe(false);
  await expect(acknowledge(kind)).rejects.toMatchObject({ status: 409 }); await read(); await acknowledge(kind); expect(getWriteUncertaintySnapshot().entries).toHaveLength(0);
});
