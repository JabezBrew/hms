import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { confirmCurrentPassword, factorApi, grantRequest } from '../api';
import { loginResult } from '../model';
import { __resetV2ApiClientForTests, configureV2ApiClient } from '@/lib/api/v2/session';
import { bindModeledNetworkGuard as bindNetworkAccessGuard } from '@/tests/networkClockModel';
import { challengeId, failure, json, keyId, pending, token, ordinaryToken, jwtFor, fixtureClock } from './fixtures';
let runtime, accessToken;
beforeEach(() => { runtime = window.__HMS_RUNTIME_CONFIG__; window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost/api/v2' }; __resetV2ApiClientForTests(); accessToken = token().access_token; configureV2ApiClient({ getAccessToken: () => accessToken, canRefreshSession: () => true }); vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => { __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = runtime; vi.unstubAllGlobals(); });
describe('restricted login and genuine factor adapters', () => {
  it('uses the generated ordinary operation with exact password bytes and no extra selectors', async () => { fetch.mockResolvedValue(json(ordinaryToken(token()))); const signal = new AbortController().signal; await confirmCurrentPassword(' Synthetic exact password ', { signal }); expect(fetch).toHaveBeenCalledTimes(1); const [url, request] = fetch.mock.calls[0]; expect(url).toBe('http://localhost/api/v2/auth/reauthenticate'); expect(request).toMatchObject({ method: 'POST', signal }); expect(JSON.parse(request.body)).toEqual({ current_password: ' Synthetic exact password ' }); });
  it('keeps the exact held bearer current when wall time crosses a whole second during confirmation', async () => {
    let now = Math.floor(Date.now() / 1000) * 1000 + 999;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      accessToken = token().access_token;
      fetch.mockImplementation(async () => { now += 2; return json(ordinaryToken(token())); });
      await expect(confirmCurrentPassword('Synthetic current password')).resolves.toMatchObject({ result: { status: 'authenticated' } });
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally { clock.mockRestore(); }
  });
  it('rejects an actual bearer replacement during that same whole-second crossing', async () => {
    let now = Math.floor(Date.now() / 1000) * 1000 + 999;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      accessToken = token().access_token;
      fetch.mockImplementation(async () => { now += 2; const result = ordinaryToken(token()); accessToken = result.access_token; return json(result); });
      await expect(confirmCurrentPassword('Synthetic current password')).rejects.toMatchObject({ name: 'AbortError' });
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally { clock.mockRestore(); }
  });
  it('keeps the actual login fixture coherent when construction crosses a whole-second tick', async () => {
    const base = Math.floor(Date.now() / 1000) * 1000 + 999; let reads = 0;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => base + (reads++ ? 2 : 0));
    try {
      const raw = token();
      fetch.mockResolvedValueOnce(json(raw));
      await expect(factorApi.login({ email: 'synthetic@example.test', password: 'Synthetic password', facility_code: 'HMS' })).resolves.toMatchObject({ status: 'authenticated' });
      const claims = JSON.parse(atob(raw.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      expect(Date.parse(raw.user.auth_security.auth_clock.issuer_observed_at)).toBeGreaterThanOrEqual(claims.iat * 1000);
      expect(claims.exp - claims.iat).toBe(600);
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally { clock.mockRestore(); }
  });
  it.each([401, 403])('never refreshes or falls back after ordinary credential status %s', async status => { fetch.mockResolvedValue(failure('synthetic_credential_denied', status)); await expect(confirmCurrentPassword('Synthetic current password')).rejects.toMatchObject({ status }); expect(fetch).toHaveBeenCalledTimes(1); expect(fetch.mock.calls[0][0]).toBe('http://localhost/api/v2/auth/reauthenticate'); });
  it.each(['', undefined])('requires an explicit current password before dispatch: %s', async password => { await expect(confirmCurrentPassword(password)).rejects.toThrow('current password'); expect(fetch).not.toHaveBeenCalled(); });
  it('suppresses a cancelled ordinary operation before generated dispatch', async () => { const controller = new AbortController(); controller.abort(); await expect(confirmCurrentPassword('Synthetic current password', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' }); expect(fetch).not.toHaveBeenCalled(); });
  it('rejects a malformed ordinary authenticated response', async () => { fetch.mockResolvedValue(json({ ...token(), status: 'factor_required' })); await expect(confirmCurrentPassword('Synthetic current password')).rejects.toThrow('could not be confirmed'); expect(fetch).toHaveBeenCalledTimes(1); });
  it('keeps only the exact ordinary own-session POST available while connection authority is unconfirmed', async () => { bindNetworkAccessGuard({ transportScope: 'synthetic-other', authorityScope: 'synthetic-guard' }); fetch.mockResolvedValue(json(ordinaryToken(token()))); await confirmCurrentPassword('Synthetic current password'); const { v2Request } = await import('@/lib/api/v2/session'); for (const [method, path] of [['POST', '/api/v2/auth/reauthenticate/extra'], ['PUT', '/api/v2/auth/reauthenticate'], ['POST', '/api/v2/inventory/storage-locations']]) await expect(v2Request({ method, path, body: {} })).rejects.toMatchObject({ status: 403 }); expect(fetch).toHaveBeenCalledTimes(1); });
  it('sends a pending grant through the exact configured endpoint without bearer or refresh', async () => { const challenge = pending(); fetch.mockResolvedValue(json(challenge)); const signal = new AbortController().signal; expect(await factorApi.login({ email: 'synthetic@example.test', password: 'Synthetic password', facility_code: 'HMS' }, { signal })).toEqual(challenge); const [url, request] = fetch.mock.calls[0]; expect(url).toBe('http://localhost/api/v2/auth/login'); expect(request).toMatchObject({ credentials: 'include', signal }); expect(request.headers.Authorization).toBeUndefined(); expect(fetch).toHaveBeenCalledTimes(1); });
  it('does not treat pending credentials or an untagged token as authentication', () => { expect(() => loginResult({ ...pending(), user: token().user })).toThrow(); const raw = token(); delete raw.status; expect(() => loginResult(raw)).toThrow(); expect(() => loginResult({ ...pending(), expires_at: '2000-01-01T00:00:00Z' })).toThrow(); });
  it('rejects arbitrary paths and never refreshes a failed login grant', async () => { await expect(grantRequest('/patients/search', {})).rejects.toThrow('Unsupported'); expect(fetch).not.toHaveBeenCalled(); fetch.mockResolvedValue(failure('login_grant_expired', 401)); await expect(factorApi.options('Synthetic grant')).rejects.toMatchObject({ status: 401 }); expect(fetch).toHaveBeenCalledTimes(1); });
  it('requires a separate assertion after setup and validates factor methods', async () => { fetch.mockResolvedValueOnce(json(token('passkey'))); await expect(factorApi.setupVerify({})).rejects.toThrow('separate assertion'); fetch.mockResolvedValueOnce(json(pending())); await expect(factorApi.setupVerify({})).resolves.toMatchObject({ status: 'factor_required' }); fetch.mockResolvedValueOnce(json(token('recovery'))); await expect(factorApi.verify({ login_grant: 'Synthetic', challenge_id: challengeId, credential: {} })).rejects.toThrow('proof'); });
  it('keeps recovery distinct and requires fresh passkey proof for step-up', async () => { fetch.mockResolvedValueOnce(json(token('recovery'))); await expect(factorApi.recovery('Synthetic grant', 'Synthetic code')).resolves.toMatchObject({ user: { auth_security: { session_assurance: { method: 'recovery' } } } }); fetch.mockResolvedValueOnce(json(token())); await expect(factorApi.stepUpVerify({ challenge_id: challengeId, credential: {} })).rejects.toThrow('proof'); });
  it('accepts a coherent proof when the clock ticks while preparing its response and rejects any overlong proof', async () => {
    const now = Date.now(); let tick = 0;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now + tick++);
    try {
      const result = token('passkey');
      fetch.mockResolvedValueOnce(json(result));
      await expect(factorApi.verify({ login_grant: 'Synthetic grant', challenge_id: challengeId, credential: {} })).resolves.toMatchObject({ status: 'authenticated' });
      const overlong = structuredClone(result); const proof = overlong.user.auth_security.session_assurance;
      proof.expires_at = new Date(Date.parse(proof.verified_at) + 900001).toISOString();
      fetch.mockResolvedValueOnce(json(overlong));
      await expect(factorApi.verify({ login_grant: 'Synthetic grant', challenge_id: challengeId, credential: {} })).rejects.toThrow('proof');
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally { clock.mockRestore(); }
  });
  it.each([0, 1])('preserves strict new-factor admission for a %sms proof gap across the actual transport', async proofGap => {
    const proofAt = Date.now(); const result = token('passkey');
    result.user.auth_security.assurance_version += 1;
    result.user.auth_security.session_assurance.verified_at = new Date(proofAt - proofGap).toISOString();
    result.user.auth_security.session_assurance.expires_at = new Date(proofAt - proofGap + 900000).toISOString();
    result.access_token = jwtFor(result, { auth_time: Math.floor(proofAt / 1000) }, proofAt);
    result.user.auth_security.auth_clock = fixtureClock(proofAt, result.access_token);
    let monotonic = 1000;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => monotonic);
    try {
      fetch.mockImplementation(async () => { monotonic += 0.5; return json(result); });
      const response = factorApi.stepUpVerify({ challenge_id: challengeId, credential: {} });
      if (proofGap) await expect(response).rejects.toMatchObject({ code: 'auth_proof_invalid' });
      else await expect(response).resolves.toMatchObject({ status: 'authenticated', user: { auth_security: { assurance_version: 2 } } });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0][0]).toBe('http://localhost/api/v2/auth/assurance/verify');
      expect(monotonic - 1000).toBe(0.5);
    } finally { clock.mockRestore(); }
  });
  it('reads bounded metadata and validates exact identifiers before writes', async () => { fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: keyId, label: null, created_at: new Date().toISOString(), last_used_at: null, disabled_at: null }], page: { has_next: false, next_cursor: null } }), { headers: { 'content-type': 'application/json' } })); await expect(factorApi.keys()).resolves.toMatchObject({ rows: [{ id: keyId }], has_next: false }); expect(fetch.mock.calls[0][0]).toContain('limit=10'); await expect(factorApi.rename('../escape', 'Synthetic')).rejects.toThrow('saved passkey'); expect(fetch).toHaveBeenCalledTimes(1); });
  it.each(['unknown', 'deny', 'readonly'])('permits exact own-security operations without upgrading %s clinical writes', async (mode) => { const binding = bindNetworkAccessGuard({ transportScope: 'invalid-for-write', authorityScope: 'synthetic-scope' }); binding.update({ confirmed: true, decision: { access_allowed: mode !== 'deny', read_only: true, classification: mode === 'unknown' ? 'unknown' : 'offsite', policy_version: 1 } }); fetch.mockImplementation(async () => json(token('passkey'))); await factorApi.stepUpVerify({}); const { v2Request } = await import('@/lib/api/v2/session'); await expect(v2Request({ method: 'POST', path: '/api/v2/clinical/prescriptions', body: {} })).rejects.toMatchObject({ status: 403 }); expect(fetch).toHaveBeenCalledTimes(1); await factorApi.disable(keyId); await expect(v2Request({ method: 'POST', path: `/api/v2/auth/mfa/passkeys/${keyId}/disable/extra`, body: {} })).rejects.toMatchObject({ status: 403 }); expect(fetch).toHaveBeenCalledTimes(2); });
  it('preserves abort and malformed-response failure without another fetch', async () => { const controller = new AbortController(); controller.abort(); await expect(factorApi.options('Synthetic', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' }); fetch.mockResolvedValue(new Response('not-json')); await expect(factorApi.options('Synthetic')).rejects.toThrow('Restart sign-in'); expect(fetch).toHaveBeenCalledTimes(1); });
});
