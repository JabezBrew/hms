import { webcrypto } from 'node:crypto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '@/lib/auth';
import { queryClient } from '@/lib/react-query';
import { NetworkAccessBoundary } from '@/features/settings/network/NetworkAccessBoundary';
import { __resetV2ApiClientForTests, configureV2ApiClient, getV2ClientScopeKey, v2Request } from '@/lib/api/v2/session';
import { getWorkflowContinuity, clearWorkflowContinuity } from '@/shared/lib/workflowContinuity';
import { dismissFactorRequirement } from '@/shared/lib/factorRequiredSignal';
import { getWriteUncertaintySnapshot } from '@/lib/api/v2/writeUncertainty';
import { token, jwtFor, json, failure, networkDecision } from './fixtures';

const runtime = window.__HMS_RUNTIME_CONFIG__;
let auth, initial, fresh, handler, requests, deferred, network;
const password = ' Synthetic exact password with spaces ';
function Probe() { auth = useAuth(); return <><button onClick={() => auth.login('synthetic@example.test', 'Synthetic login password', 'HMS').catch(() => {})}>Begin ordinary session</button>{auth.user && <NetworkAccessBoundary><p>Synthetic current workspace</p></NetworkAccessBoundary>}</>; }
async function mount() {
  render(<QueryClientProvider client={queryClient}><MemoryRouter><AuthProvider><Probe /></AuthProvider></MemoryRouter></QueryClientProvider>);
  fireEvent.click(screen.getByText('Begin ordinary session')); await screen.findByText('Synthetic current workspace');
}
async function confirm(options) { let result; await act(async () => { result = await auth.reauthenticate(auth.user.email, password, 'HMS', options).catch(error => error); }); return result; }
function renew() { fresh = structuredClone(initial); fresh.user.auth_security.assurance_version += 1; fresh.access_token = jwtFor(fresh, { auth_time: Math.floor(Date.now() / 1000) }); }
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto); localStorage.clear(); sessionStorage.clear(); queryClient.clear(); queryClient.setDefaultOptions({ queries: { retry: false, gcTime: 0 }, mutations: { retry: false } }); __resetV2ApiClientForTests(); clearWorkflowContinuity(); dismissFactorRequirement();
  window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost/api/v2', defaultFacilityCode: 'HMS' };
  initial = token(null, { permissions: ['inventory.view', 'inventory.manage', 'patient.demographics.view'], features: ['inventory'], patient_visibility: ['demographics'] });
  initial.access_token = jwtFor(initial, { auth_time: Math.floor(Date.now() / 1000) - 120 }); renew(); requests = []; deferred = null; network = null;
  handler = async path => path.endsWith('/auth/reauthenticate') ? json(fresh) : failure('synthetic_route_unavailable', 404);
  vi.stubGlobal('fetch', vi.fn(async (url, request = {}) => {
    const path = new URL(url).pathname; requests.push({ path, request });
    if (path.endsWith('/auth/login')) return json(initial);
    if (path.endsWith('/auth/network-access')) return network && request.headers.Authorization === `Bearer ${fresh.access_token}` ? network : json(networkDecision());
    return handler(path, request);
  }));
});
afterEach(() => { cleanup(); queryClient.clear(); __resetV2ApiClientForTests(); clearWorkflowContinuity(); dismissFactorRequirement(); localStorage.clear(); sessionStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); window.__HMS_RUNTIME_CONFIG__ = runtime; });

it('uses the actual generated password-only operation and preserves exact same-session proof without factor evidence', async () => {
  await mount(); const before = getV2ClientScopeKey(); await confirm();
  expect(auth.getAccessToken()).toBe(fresh.access_token); expect(getV2ClientScopeKey()).not.toBe(before); expect(getWorkflowContinuity()).not.toBeNull();
  const proof = requests.filter(({ path }) => path.endsWith('/auth/reauthenticate')); expect(proof).toHaveLength(1); expect(JSON.parse(proof[0].request.body)).toEqual({ current_password: password });
  expect(proof[0].request.headers.Authorization).toBe(`Bearer ${initial.access_token}`); expect(requests.some(({ path }) => path.includes('/assurance/') || path.endsWith('/auth/logout') || path.endsWith('/auth/refresh'))).toBe(false);
  expect(requests.filter(({ path }) => path.endsWith('/auth/login'))).toHaveLength(1);
  expect(JSON.stringify(localStorage) + JSON.stringify(sessionStorage)).not.toContain(password);
  expect(auth.user.accessContext.auth_security.session_assurance).toEqual(initial.user.auth_security.session_assurance);
});
it('preserves a coherent unchanged imported recovery proof without strengthening it', async () => {
  initial.user.auth_security.session_assurance = token('recovery').user.auth_security.session_assurance; renew(); await mount(); await confirm();
  expect(auth.getAccessToken()).toBe(fresh.access_token); expect(getWorkflowContinuity()).not.toBeNull(); expect(auth.user.accessContext.auth_security.session_assurance).toEqual(initial.user.auth_security.session_assurance);
});
it('accepts actual same-second password time with an advanced assurance revision', async () => {
  const second = Math.floor(Date.now() / 1000); initial.access_token = jwtFor(initial, { auth_time: second, iat: second }); renew(); fresh.access_token = jwtFor(fresh, { auth_time: second, iat: second });
  await mount(); await confirm(); expect(auth.getAccessToken()).toBe(fresh.access_token); expect(auth.user.accessContext.auth_security.assurance_version).toBe(2); expect(getWorkflowContinuity()).not.toBeNull();
});
it.each([2, 3])('applies only the explicit two-second admission clock tolerance, offset=%s', async offset => {
  const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now);
  fresh.access_token = jwtFor(fresh, { auth_time: Math.floor(now / 1000) - offset }); await mount(); const result = await confirm();
  if (offset === 2) { expect(result).not.toBeInstanceOf(Error); expect(auth.getAccessToken()).toBe(fresh.access_token); }
  else { expect(result).toBeInstanceOf(Error); expect(auth.getAccessToken()).not.toBe(fresh.access_token); }
});
it('accepts real dispatch admission time even when the retained response arrives much later', async () => {
  let now = Date.now(); vi.spyOn(Date, 'now').mockImplementation(() => now); await mount();
  handler = async () => new Promise(resolve => { deferred = resolve; }); let pending;
  act(() => { pending = auth.reauthenticate(auth.user.email, password, 'HMS').catch(error => error); }); await waitFor(() => expect(deferred).toBeTypeOf('function')); now += 30000;
  await act(async () => { deferred(json(fresh)); await pending; }); expect(auth.getAccessToken()).toBe(fresh.access_token); expect(getWorkflowContinuity()).not.toBeNull();
});
it('applies an exact same-session token after genuine subsecond proof expiry and clears workflow continuity', async () => {
  const second = Math.floor(Date.now() / 1000) * 1000; let now = second + 100; vi.spyOn(Date, 'now').mockImplementation(() => now);
  initial.user.auth_security.session_assurance = { method: 'recovery', verified_at: new Date(second - 899500).toISOString(), expires_at: new Date(second + 500).toISOString(), credential_id: null };
  initial.access_token = jwtFor(initial, { auth_time: second / 1000 - 120 }); renew(); fresh.user.auth_security.session_assurance = token().user.auth_security.session_assurance;
  await mount(); now = second + 800; await confirm();
  expect(auth.getAccessToken()).toBe(fresh.access_token); expect(getWorkflowContinuity()).toBeNull(); expect(auth.user.accessContext.auth_security.session_assurance.method).toBeNull();
});
const invalid = [
  ['different response actor', value => { value.user.id = '99999999-0000-4000-8000-000000000099'; }],
  ['different response facility', value => { value.user.facility_id = '99999999-0000-4000-8000-000000000099'; }],
  ['different response profile', value => { value.user.active_profile = 'clinic'; }],
  ['different response session version', value => { value.user.session_version = 2; }],
  ['different response permission version', value => { value.user.permission_version = 2; }],
  ['malformed signed token', value => { value.access_token = 'synthetic-malformed-token'; }],
  ['different session', value => { value.access_token = jwtFor(value, { session_id: '99999999-0000-4000-8000-000000000099' }); }],
  ['wrong token actor', value => { value.access_token = jwtFor(value, { sub: '99999999-0000-4000-8000-000000000099' }); }],
  ['wrong token facility', value => { value.access_token = jwtFor(value, { facility_id: '99999999-0000-4000-8000-000000000099' }); }],
  ['wrong token profile', value => { value.access_token = jwtFor(value, { active_profile: 'clinic' }); }],
  ['wrong session version', value => { value.access_token = jwtFor(value, { session_version: 2 }); }],
  ['wrong permission version', value => { value.access_token = jwtFor(value, { permission_version: 2 }); }],
  ['nonadvanced revision', value => { value.user.auth_security.assurance_version = 1; }],
  ['malformed revision', value => { value.user.auth_security.assurance_version = '2'; }],
  ['backward auth time', value => { value.access_token = jwtFor(value, { auth_time: Math.floor(Date.now() / 1000) - 121 }); }],
  ['malformed auth time', value => { value.access_token = jwtFor(value, { auth_time: 'fresh' }); }],
  ['unchanged stale auth time', value => { value.access_token = jwtFor(value, { auth_time: Math.floor(Date.now() / 1000) - 120 }); }],
  ['future auth time', value => { value.access_token = jwtFor(value, { auth_time: Math.floor(Date.now() / 1000) + 30 }); }],
  ['malformed iat', value => { value.access_token = jwtFor(value, { iat: null }); }],
  ['changed factor version', value => { value.user.auth_security.factor_version += 1; }],
  ['unexpected privilege', value => { value.user.auth_security.privileged_user = true; }],
  ['unexpected enrollment', value => { value.user.auth_security.passkey_enrolled = true; }],
  ['unexpected permission', value => { value.user.permissions.push('admin.authority.manage'); }],
  ['malformed factor evidence', value => { delete value.user.auth_security.session_assurance.expires_at; }],
  ['invented factor evidence', value => { value.user.auth_security.session_assurance = token('recovery').user.auth_security.session_assurance; }],
];
it.each(invalid)('rejects %s before applying any same-session token', async (label, change) => {
  change(fresh); await mount(); const result = await confirm(); expect(result).toBeInstanceOf(Error); expect(auth.getAccessToken()).not.toBe(fresh.access_token); expect(getWorkflowContinuity()).toBeNull();
  expect(requests.filter(({ path }) => path.endsWith('/auth/reauthenticate'))).toHaveLength(1); expect(requests.some(({ path }) => path.includes('/assurance/') || path.endsWith('/auth/refresh'))).toBe(false);
});
it.each(['extended', 'cleared before expiry'])('rejects %s existing factor evidence', async change => {
  initial.user.auth_security.session_assurance = token('recovery').user.auth_security.session_assurance; renew();
  if (change === 'extended') fresh.user.auth_security.session_assurance.expires_at = new Date(Date.parse(fresh.user.auth_security.session_assurance.expires_at) + 1000).toISOString();
  else fresh.user.auth_security.session_assurance = token().user.auth_security.session_assurance;
  await mount(); expect(await confirm()).toBeInstanceOf(Error); expect(auth.getAccessToken()).not.toBe(fresh.access_token); expect(getWorkflowContinuity()).toBeNull();
});
it.each([400, 401, 403, 409, 429])('never refreshes, changes identity or falls back after a credential response %s', async status => {
  handler = async () => failure('synthetic_confirmation_failed', status); await mount(); expect(await confirm()).toMatchObject({ status });
  expect(auth.getAccessToken()).toBe(initial.access_token); expect(getWorkflowContinuity()).toBeNull(); expect(requests.filter(({ path }) => !path.endsWith('/auth/network-access'))).toHaveLength(2);
});
it('suppresses a late response after explicit cancellation', async () => {
  handler = async () => new Promise(resolve => { deferred = resolve; }); await mount(); const controller = new AbortController(); let pending;
  act(() => { pending = auth.reauthenticate(auth.user.email, password, 'HMS', { signal: controller.signal }).catch(error => error); }); await waitFor(() => expect(deferred).toBeTypeOf('function'));
  controller.abort(); let result; await act(async () => { deferred(json(fresh)); result = await pending; }); expect(result.name).toBe('AbortError'); expect(auth.getAccessToken()).toBe(initial.access_token); expect(getWorkflowContinuity()).toBeNull();
});
it('suppresses an old response after the actual transport changes', async () => {
  handler = async () => new Promise(resolve => { deferred = resolve; }); await mount(); let pending;
  act(() => { pending = auth.reauthenticate(auth.user.email, password, 'HMS').catch(error => error); }); await waitFor(() => expect(deferred).toBeTypeOf('function'));
  act(() => configureV2ApiClient({ getAccessToken: () => 'synthetic-other-transport', getFacilityCode: () => 'HMS' }));
  let result; await act(async () => { deferred(json(fresh)); result = await pending; }); expect(result.name).toBe('AbortError'); expect(auth.getAccessToken()).toBe(initial.access_token); expect(getWorkflowContinuity()).toBeNull();
});
it.each(['denied', 'failed', 'unknown'])('applies valid credential proof without continuity when the staged network is %s and retains unknown writes', async kind => {
  await mount(); handler = async path => path.endsWith('/auth/reauthenticate') ? json(fresh) : Promise.reject(new TypeError('Synthetic original response lost'));
  await expect(v2Request({ method: 'POST', path: '/api/v2/inventory/storage-locations', body: { client_request_id: crypto.randomUUID(), code: 'SYNTHETIC', name: 'Synthetic location', location_type: 'store', temperature_zone: 'ambient' } })).rejects.toBeDefined(); expect(getWriteUncertaintySnapshot().entries).toHaveLength(1);
  network = kind === 'failed' ? failure('synthetic_network_failed', 503) : json({ ...networkDecision(), ...(kind === 'denied' ? { access_allowed: false, classification: 'offsite', mode: 'deny' } : { classification: 'unknown' }) });
  await confirm(); expect(auth.getAccessToken()).toBe(fresh.access_token); expect(getWorkflowContinuity()).toBeNull(); await waitFor(() => expect(getWriteUncertaintySnapshot().entries).toHaveLength(1));
  expect(requests.filter(({ path, request }) => path.endsWith('/storage-locations') && request.method === 'POST')).toHaveLength(1);
});
