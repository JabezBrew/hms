import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { configureV2ApiClient, __resetV2ApiClientForTests, v2Request } from '@/lib/api/v2/session';
import { authorizationIdentity } from '@/shared/lib/authorizationScope';
import { serverClock } from '@/shared/lib/serverClock';
import { clockInstant, observeAssurance, observeTokenResponse } from '../clock';
import { json, failure, jwtFor, token, keyId } from './fixtures';

// Actual client/transport source stamps execute. Server replies and JWT signatures
// are modeled contract fixtures; no native clock/ceremony acceptance is claimed.
const issuer = '2026-10-18T10:00:00.123456789Z';
const database = '2026-10-18T10:01:00.987654321Z';
const issuerSecond = Date.parse('2026-10-18T10:00:00Z') / 1000;
const rawClock = () => ({ database_observed_at: database, issuer_observed_at: issuer, access_token_remaining_ms: 599876 });
let runtime, handler, requests;
function responseToken() {
  const value = token();
  value.user.auth_security.assurance_version = 2;
  value.user.auth_security.auth_clock = rawClock();
  value.access_token = jwtFor(value, { auth_time: issuerSecond, iat: issuerSecond, exp: issuerSecond + 600 });
  value.expires_in_seconds = 600;
  value.session_idle_expires_at = '2026-10-18T10:31:00Z';
  value.session_absolute_expires_at = '2026-10-18T18:01:00Z';
  value.refresh_expires_at = value.session_absolute_expires_at;
  value.ordinary_confirmation = { purpose: 'ordinary_password_confirmation', session_id: '99999999-0000-4000-8000-000000000020', assurance_version: 2, admitted_at: database, published_password_verified_at: database };
  return value;
}
async function original(value, { path = '/api/v2/auth/reauthenticate', method = 'POST', signal } = {}) {
  handler = () => json(value);
  return (await v2Request({ path, method, signal, ...(method === 'POST' ? { body: { current_password: 'Synthetic password' }, skipAuthRefresh: true } : {}) })).data;
}
beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto); localStorage.clear(); sessionStorage.clear(); __resetV2ApiClientForTests();
  runtime = window.__HMS_RUNTIME_CONFIG__;
  window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost/api/v2' };
  configureV2ApiClient({ getAccessToken: () => responseToken().access_token, getFacilityCode: () => 'HMS', canRefreshSession: () => false });
  requests = []; handler = () => failure('synthetic_unavailable', 404);
  vi.stubGlobal('fetch', vi.fn(async (url, request) => { requests.push(new URL(url).pathname); return handler(new URL(url).pathname, request); }));
});
afterEach(() => { __resetV2ApiClientForTests(); localStorage.clear(); sessionStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks(); window.__HMS_RUNTIME_CONFIG__ = runtime; });

it('preserves nanoseconds and the actual issuer clamp under independent DB/issuer/browser clocks', async () => {
  const originalNow = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(originalNow + 86400000);
  const value = await original(responseToken());
  expect(observeTokenResponse(value, { ordinary: true })).toBe(value);
  expect(clockInstant(database) - clockInstant('2026-10-18T10:01:00Z')).toBe(987654321n);
  expect(serverClock(value).tokenRemaining()).toBeGreaterThan(0);
  expect(serverClock(value).tokenRemaining()).toBeLessThanOrEqual(599876);
});
it('rejects a caller copy with the same clock/body because it has no actual transport source', async () => {
  const value = await original(responseToken());
  expect(() => observeTokenResponse(structuredClone(value), { ordinary: true })).toThrow();
  expect(observeTokenResponse(value, { ordinary: true })).toBe(value);
});
it('rejects a witness500nanoseconds beyond the DB observation without rounding grace', async () => {
  const value = responseToken(); value.ordinary_confirmation.admitted_at = '2026-10-18T10:01:00.987654821Z'; value.ordinary_confirmation.published_password_verified_at = value.ordinary_confirmation.admitted_at;
  const delivered = await original(value);
  expect(() => observeTokenResponse(delivered, { ordinary: true })).toThrow();
});
it.each(['expired issuer', 'configuredTTL substitute', 'malformed fraction'])('rejects %s from the actual response', async kind => {
  const value = responseToken();
  if (kind === 'expired issuer') value.user.auth_security.auth_clock.issuer_observed_at = '2026-10-18T10:11:00Z';
  if (kind === 'configuredTTL substitute') value.user.auth_security.auth_clock.access_token_remaining_ms = 600000;
  if (kind === 'malformed fraction') value.user.auth_security.auth_clock.database_observed_at = '2026-10-18T10:01:00.9876543219Z';
  const delivered = await original(value);
  expect(() => observeTokenResponse(delivered, { ordinary: true })).toThrow();
});
it('accepts retained assurance proof within its server window without inventing new-command admission', async () => {
  const data = { auth_clock: rawClock(), password_verified_at: '2026-10-18T09:59:00Z', password_fresh_until: '2026-10-18T10:29:00Z', assurance: { method: 'passkey', verified_at: '2026-10-18T09:56:00Z', expires_at: '2026-10-18T10:11:00Z', credential_id: keyId } };
  const value = await original(data, { path: '/api/v2/auth/assurance', method: 'GET' });
  expect(observeAssurance(value)).toBe(value);
  expect(serverClock(value.assurance).remaining(value.assurance.expires_at)).toBeGreaterThan(0);
  const created = responseToken(); created.ordinary_confirmation = null; created.user.auth_security.session_assurance = data.assurance;
  const result = await original(created, { path: '/api/v2/auth/assurance/verify' });
  expect(() => observeTokenResponse(result, { newFactor: 'passkey' })).toThrow();
});
it('keeps an old actual response invalid after current403 followed by a fresh same-scope response', async () => {
  const old = await original(responseToken());
  handler = () => failure('synthetic_current_denial', 403);
  await expect(v2Request({ path: '/api/v2/auth/assurance' })).rejects.toMatchObject({ status: 403 });
  const fresh = await original(responseToken());
  expect(observeTokenResponse(fresh, { ordinary: true })).toBe(fresh);
  expect(() => observeTokenResponse(old, { ordinary: true })).toThrow();
});
it('preserves cancellation after an actual response before typed observation publication', async () => {
  const controller = new AbortController();
  const value = await original(responseToken(), { signal: controller.signal });
  controller.abort();
  expect(() => observeTokenResponse(value, { ordinary: true })).toThrow();
  expect(requests).toHaveLength(1);
});

it.each(['security flag', 'assurance revision', 'token session', 'issuer future'])('rejects malformed or future %s without an application branch', async kind => {
  const value = responseToken();
  if (kind === 'security flag') value.user.auth_security.passkey_required = 'false';
  if (kind === 'assurance revision') value.user.auth_security.assurance_version = undefined;
  if (kind === 'token session') value.access_token = jwtFor(value, { session_id: 'malformed', iat: issuerSecond, auth_time: issuerSecond, exp: issuerSecond +600 });
  if (kind === 'issuer future') { value.access_token = jwtFor(value, { iat: issuerSecond +1, auth_time: issuerSecond, exp: issuerSecond +601 }); value.ordinary_confirmation.session_id = '99999999-0000-4000-8000-000000000020'; }
  const delivered = await original(value);
  expect(() => observeTokenResponse(delivered, { ordinary: true })).toThrow();
});

it('excludes only observational auth_clock from identity while real factor authority still changes it', () => {
  const user = { id: 'synthetic', accessContext: { auth_security: { factor_version: 1, assurance_version: 1, auth_clock: rawClock() } } };
  const changed = structuredClone(user); changed.accessContext.auth_security.auth_clock.database_observed_at = '2026-10-18T11:00:00Z';
  expect(authorizationIdentity(changed)).toBe(authorizationIdentity(user)); expect(authorizationIdentity(user)).not.toContain('2026-10');
  changed.accessContext.auth_security.factor_version = 2; expect(authorizationIdentity(changed)).not.toBe(authorizationIdentity(user));
});
