import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { factorApi, grantRequest } from '../api';
import { loginResult } from '../model';
import { __resetV2ApiClientForTests, configureV2ApiClient } from '@/lib/api/v2/session';
import { bindNetworkAccessGuard } from '@/lib/api/v2/networkAccessGuard';
import { challengeId, failure, json, keyId, pending, token } from './fixtures';
let runtime;
beforeEach(() => { runtime = window.__HMS_RUNTIME_CONFIG__; window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost/api/v2' }; __resetV2ApiClientForTests(); configureV2ApiClient({ getAccessToken: () => 'synthetic-stale-bearer', canRefreshSession: () => true }); vi.stubGlobal('fetch', vi.fn()); });
afterEach(() => { __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = runtime; vi.unstubAllGlobals(); });
describe('restricted login and genuine factor adapters', () => {
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
  it('reads bounded metadata and validates exact identifiers before writes', async () => { fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: keyId, label: null, created_at: new Date().toISOString(), last_used_at: null, disabled_at: null }], page: { has_next: false, next_cursor: null } }), { headers: { 'content-type': 'application/json' } })); await expect(factorApi.keys()).resolves.toMatchObject({ rows: [{ id: keyId }], has_next: false }); expect(fetch.mock.calls[0][0]).toContain('limit=10'); await expect(factorApi.rename('../escape', 'Synthetic')).rejects.toThrow('saved passkey'); expect(fetch).toHaveBeenCalledTimes(1); });
  it.each(['unknown', 'deny', 'readonly'])('permits exact own-security operations without upgrading %s clinical writes', async (mode) => { const binding = bindNetworkAccessGuard({ transportScope: 'invalid-for-write', authorityScope: 'synthetic-scope' }); binding.update({ confirmed: true, decision: { access_allowed: mode !== 'deny', read_only: true, classification: mode === 'unknown' ? 'unknown' : 'offsite', policy_version: 1 } }); fetch.mockImplementation(async () => json(token('passkey'))); await factorApi.stepUpVerify({}); const { v2Request } = await import('@/lib/api/v2/session'); await expect(v2Request({ method: 'POST', path: '/api/v2/clinical/prescriptions', body: {} })).rejects.toMatchObject({ status: 403 }); expect(fetch).toHaveBeenCalledTimes(1); await factorApi.disable(keyId); await expect(v2Request({ method: 'POST', path: `/api/v2/auth/mfa/passkeys/${keyId}/disable/extra`, body: {} })).rejects.toMatchObject({ status: 403 }); expect(fetch).toHaveBeenCalledTimes(2); });
  it('preserves abort and malformed-response failure without another fetch', async () => { const controller = new AbortController(); controller.abort(); await expect(factorApi.options('Synthetic', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' }); fetch.mockResolvedValue(new Response('not-json')); await expect(factorApi.options('Synthetic')).rejects.toThrow('Restart sign-in'); expect(fetch).toHaveBeenCalledTimes(1); });
});
