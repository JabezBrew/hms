import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { configureV2ApiClient, __resetV2ApiClientForTests, getV2ClientScopeKey, v2Request } from '../session';
import { bindNetworkAccessGuard, subscribeNetworkOwner } from '../networkAccessGuard';
import { isCurrentReadDenial } from '../readDenials';
import { authorizationIdentity } from '@/shared/lib/authorizationScope';
import { clockToken } from '@/features/auth/__tests__/clock-fixtures';
import { invalidateServerClockReads, clockGeneration } from '@/shared/lib/serverClock';
import { assertWriteRecoveryReadCurrent, getWriteUncertaintySnapshot } from '../writeUncertainty';
const runtime = window.__HMS_RUNTIME_CONFIG__;
const path = '/api/v2/scheduling/services/23232323-2323-4232-8232-000000000003/administration';
let token, binding, enteredBody, releaseBody, response;
const principal = { id: '99999999-0000-4000-8000-000000000001', facility_id: '99999999-0000-4000-8000-000000000002', active_profile: 'hospital', session_version: 1, permission_version: 1 };
const configure = () => configureV2ApiClient({ getAccessToken: () => token, getFacilityCode: () => 'HMS', canRefreshSession: () => false });
function bind(authority = 'synthetic-authority-A') { binding = bindNetworkAccessGuard({ transportScope: getV2ClientScopeKey(), authorityScope: authority, principal: { ...principal }, readOwnerValue: 'synthetic-complete-read-owner-A' }); binding.update({ confirmed: true, decision: { access_allowed: true, read_only: false, classification: 'onsite', policy_version: 1 } }); }
const denied = (malformed = false) => new Response(malformed ? 'malformed-json' : JSON.stringify({ error: { code: 'permission_denied', message: 'Synthetic denied read' } }), { status: 403, headers: { 'content-type': 'application/json' } });
beforeEach(() => {
  __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost/api/v2' }; token = 'synthetic-opaque-read-owner-A'; configure(); bind(); response = denied(); enteredBody = null; releaseBody = null;
  vi.stubGlobal('fetch', vi.fn(async () => response));
});
afterEach(() => { __resetV2ApiClientForTests(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.__HMS_RUNTIME_CONFIG__ = runtime; });
async function errorFor(options = {}) { try { await v2Request({ path, ...options }); throw new Error('Expected the actual HTTP denial'); } catch (error) { expect(error.status).toBe(403); return error; } }
function deferBody() { const body = JSON.parse(JSON.stringify({ error: { code: 'permission_denied', message: 'Synthetic denied read' } })); const entered = new Promise(resolve => { enteredBody = resolve; }); response.json = vi.fn(() => { enteredBody(); return new Promise(resolve => { releaseBody = () => resolve(body); }); }); return entered; }
it.each([false, true])('authenticates an actual current GET403 before parsing its body, malformed=%s', async malformed => {
  response = denied(malformed); const before = clockGeneration(), error = await errorFor(); expect(clockGeneration()).toBeGreaterThan(before); expect(isCurrentReadDenial(error)).toBe(true); expect(fetch).toHaveBeenCalledTimes(1);
  expect(() => assertWriteRecoveryReadCurrent(error)).toThrow(); expect(getWriteUncertaintySnapshot().entries).toEqual([]);
});
it('same-owner configure/checking/clock invalidation during a delayed body cannot revoke its own current denial', async () => {
  const entered = deferBody(); const pending = errorFor(); await entered; configure(); invalidateServerClockReads(); binding.update({ confirmed: false, decision: null }); configure(); binding.update({ confirmed: true, decision: { access_allowed: true, read_only: false, classification: 'onsite', policy_version: 1 } }); releaseBody(); const error = await pending; expect(isCurrentReadDenial(error)).toBe(true);
});
it.each(['transport', 'transport A→B→A', 'authority A→B→A'])('permanently rejects a delayed denial after committed %s changes', async change => {
  const entered = deferBody(); const pending = errorFor(); await entered;
  if (change.startsWith('transport')) { token = 'synthetic-opaque-read-owner-B'; configure(); if (change.includes('A→B→A')) { token = 'synthetic-opaque-read-owner-A'; configure(); } }
  else { bind('synthetic-authority-B'); bind(); }
  releaseBody(); const error = await pending; expect(isCurrentReadDenial(error)).toBe(false);
});
it('a previously current error cannot regain its witness after owner A→B→A', async () => {
  const error = await errorFor(); expect(isCurrentReadDenial(error)).toBe(true); token = 'synthetic-opaque-read-owner-B'; configure(); token = 'synthetic-opaque-read-owner-A'; configure(); expect(isCurrentReadDenial(error)).toBe(false);
});
it('does not stamp a canceled delayed body or a pre-dispatch AbortError', async () => {
  const entered = deferBody(), controller = new AbortController(); const pending = errorFor({ signal: controller.signal }); await entered; controller.abort(); releaseBody(); expect(isCurrentReadDenial(await pending)).toBe(false);
  const calls = fetch.mock.calls.length; let aborted; try { await v2Request({ path, signal: controller.signal }); } catch (error) { aborted = error; } expect(aborted.name).toBe('AbortError'); expect(isCurrentReadDenial(aborted)).toBe(false); expect(fetch).toHaveBeenCalledTimes(calls);
});
it('never accepts copied, serialized or forged errors as a transport witness', async () => {
  const error = await errorFor(); expect(isCurrentReadDenial(error)).toBe(true); for (const copy of [Object.assign(new Error(error.message), error), JSON.parse(JSON.stringify(error)), { status: 403, data: error.data }]) expect(isCurrentReadDenial(copy)).toBe(false);
});
it('does not stamp an actual own-session POST403 or a synthetic preflight rejection', async () => {
  const error = await errorFor({ method: 'POST', path: '/api/v2/auth/reauthenticate', body: {} }); expect(isCurrentReadDenial(error)).toBe(false); expect(fetch).toHaveBeenCalledTimes(1);
  const copy = Object.assign(new Error('Synthetic preflight rejection'), { status: 403 }); expect(isCurrentReadDenial(copy)).toBe(false);
});
it('isolates owner observer failures from established binding and denial handling', async () => {
  const stop = subscribeNetworkOwner(() => { throw new Error('Synthetic observer failed'); }); try { expect(() => bind()).not.toThrow(); expect(isCurrentReadDenial(await errorFor())).toBe(true); } finally { stop(); }
});
it('never admits an old headers response after committed owner A→B→A before receipt', async () => {
  let releaseHeaders; fetch.mockImplementation(() => new Promise(resolve => { releaseHeaders = resolve; })); const pending = errorFor(); await Promise.resolve();
  token = 'synthetic-opaque-read-owner-B'; configure(); token = 'synthetic-opaque-read-owner-A'; configure(); releaseHeaders(denied()); expect(isCurrentReadDenial(await pending)).toBe(false);
});

function factOwner() { return { id: principal.id, facilityCode: 'HMS', adminAccess: { capabilities: ['appointment.view', 'patient.demographics.view'] }, accessContext: { facility_id: principal.facility_id, active_profile: 'hospital', session_version: 1, permission_version: 1, features: ['appointments'], patient_visibility: ['demographics'], auth_security: { assurance_version: 1, factor_version: 1 } } }; }
function bindFacts(user) { const { auth_clock: _clock, ...security } = user.accessContext.auth_security; const value = { ...user, accessContext: { ...user.accessContext, auth_security: security } }; binding = bindNetworkAccessGuard({ transportScope: getV2ClientScopeKey(), authorityScope: authorizationIdentity(user), readOwnerValue: JSON.stringify(value), principal: { ...principal, active_profile: user.accessContext.active_profile, permission_version: user.accessContext.permission_version } }); binding.update({ confirmed: true, decision: null }); }
it.each(['assurance_version', 'factor_version', 'active_profile', 'permission_version', 'patient_visibility'])('same raw JWT cannot revive a denial after committed %s A→B→A', async fact => {
  token = clockToken().access_token; configure(); const originalToken = token, beforeScope = getV2ClientScopeKey(), user = factOwner(); bindFacts(user);
  expect(JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).assurance_version).toBeUndefined();
  const entered = deferBody(), pending = errorFor(); await entered; const original = structuredClone(user);
  if (fact === 'assurance_version' || fact === 'factor_version') user.accessContext.auth_security[fact] = 2;
  else if (fact === 'patient_visibility') user.accessContext.patient_visibility = ['demographics', 'full_clinical'];
  else user.accessContext[fact] = fact === 'active_profile' ? 'clinic' : 2;
  bindFacts(user); bindFacts(original); releaseBody(); const error = await pending;
  expect(token).toBe(originalToken); expect(getV2ClientScopeKey()).toBe(beforeScope); expect(isCurrentReadDenial(error)).toBe(false);
});
it('same raw JWT and unchanged authority survive observation-only clock changes', async () => {
  token = clockToken().access_token; configure(); const user = factOwner(); bindFacts(user); const entered = deferBody(), pending = errorFor(); await entered;
  user.accessContext.auth_security.auth_clock = { database_observed_at: '2030-01-01T00:00:00Z', issuer_observed_at: '2030-01-01T00:00:00Z', access_token_remaining_ms: 1 };
  bindFacts(user); releaseBody(); expect(isCurrentReadDenial(await pending)).toBe(true);
});

it('rejects a changed raw bearer even when its legacy query-scope hash collides', async () => {
  token = `${clockToken().access_token}Aa`; configure(); bind();
  const beforeScope = getV2ClientScopeKey(), entered = deferBody(), pending = errorFor(); await entered;
  token = `${token.slice(0, -2)}BB`; configure();
  expect(getV2ClientScopeKey()).toBe(beforeScope); releaseBody();
  expect(isCurrentReadDenial(await pending)).toBe(false);
});

it('does not stamp a GET403 when the internal exact owner precondition has never been supplied', async () => {
  binding = bindNetworkAccessGuard({ transportScope: getV2ClientScopeKey(), authorityScope: 'synthetic-authority-A', principal: { ...principal } });
  expect(isCurrentReadDenial(await errorFor())).toBe(false);
});
