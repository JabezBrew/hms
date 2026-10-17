import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { __resetV2ApiClientForTests, configureV2ApiClient, getV2ClientScopeKey, v2Request } from '../session';
import { bindNetworkAccessGuard } from '../networkAccessGuard';
import { authorizationIdentity, authorizationScope } from '@/shared/lib/authorizationScope';
import { dismissFactorRequirement, getFactorRequirement, subscribeFactorRequirement } from '@/shared/lib/factorRequiredSignal';

const originalFetch = globalThis.fetch;
const originalRuntime = window.__HMS_RUNTIME_CONFIG__;
const user = {
  id: '00000000-0000-4000-8000-000000000001', facilityCode: 'PRIVATE-FACILITY',
  accessContext: { facility_id: '00000000-0000-4000-8000-000000000002', active_profile: 'hospital', session_version: 1, permission_version: 1 },
};
const principal = () => ({ id: user.id, facility_id: user.accessContext.facility_id, active_profile: 'hospital' });
let token;
function bind({ authority = authorizationIdentity(user), actor = principal(), readOnly = false } = {}) {
  const lease = bindNetworkAccessGuard({ transportScope: getV2ClientScopeKey(), authorityScope: authority, principal: actor });
  lease.update({ confirmed: true, decision: { access_allowed: true, read_only: readOnly, classification: 'onsite', mode: 'onsite', policy_version: 1 } });
  return lease;
}
const errorResponse = (code, status = 403) => new Response(JSON.stringify({ error: { code, message: 'Private clinical response text', context: { patient: 'private-record' } } }), { status, headers: { 'content-type': 'application/json' } });
const request = (options = {}) => v2Request({ path: '/api/v2/auth/me', skipAuthRefresh: true, ...options });

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  token = 'private-bearer-value';
  window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost:8080/api/v2' };
  __resetV2ApiClientForTests(); dismissFactorRequirement();
  configureV2ApiClient({ getAccessToken: () => token, getFacilityCode: () => user.facilityCode, canRefreshSession: () => false });
  globalThis.fetch = vi.fn(); bind();
});
afterEach(() => {
  vi.unstubAllGlobals(); globalThis.fetch = originalFetch; window.__HMS_RUNTIME_CONFIG__ = originalRuntime;
  __resetV2ApiClientForTests(); dismissFactorRequirement();
});

describe('current-authority factor requirement from the real fetch boundary', () => {
  it.each(['passkey_verification_required', 'password_confirmation_required', 'reauth_required'])('publishes only the opaque current scope for %s and preserves the denied result', async (code) => {
    const listener = vi.fn(); const release = subscribeFactorRequirement(listener);
    try {
      globalThis.fetch.mockResolvedValueOnce(errorResponse(code));
      await expect(request()).rejects.toMatchObject({ status: 403, data: { error: { code } } });
      expect(getFactorRequirement()).toBe(authorizationScope(user, getV2ClientScopeKey()));
      expect(getFactorRequirement()).toMatch(/^[a-z0-9_-]+$/i);
      for (const value of [user.id, user.facilityCode, user.accessContext.facility_id, token, 'private-record', 'Private clinical response text', code]) expect(getFactorRequirement()).not.toContain(value);
      expect(listener).toHaveBeenCalledExactlyOnceWith(); expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    } finally { release(); }
  });

  it.each([
    ['permission_denied', 403], ['password_change_required', 403], ['factor_authorization_expired', 403],
    ['network_reauth_required', 403], ['passkey_verification_required_extra', 403],
    ['passkey_verification_required', 401], ['passkey_verification_required', 409], ['passkey_verification_required', 500],
  ])('does not treat %s HTTP %s as repairable factor proof', async (code, status) => {
    globalThis.fetch.mockResolvedValueOnce(errorResponse(code, status));
    await expect(request()).rejects.toMatchObject({ status });
    expect(getFactorRequirement()).toBeNull(); expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['authority', 'transport', 'principal', 'mutated-principal', 'logout', 'abort'])('ignores a delayed factor denial after %s changes', async (change) => {
    const actor = principal(); bind({ actor });
    let finish; globalThis.fetch.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const controller = new AbortController(); const pending = request({ signal: controller.signal }).catch((error) => error);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    if (change === 'authority') bind({ authority: `${authorizationIdentity(user)}-new-permission` });
    if (change === 'transport') token = 'rotated-private-token';
    if (change === 'principal') bind({ actor: { ...actor, id: 'different-account' } });
    if (change === 'mutated-principal') actor.active_profile = 'different-profile';
    if (change === 'logout') bind({ authority: null, actor: null });
    if (change === 'abort') controller.abort();
    finish(errorResponse('passkey_verification_required'));
    await expect(pending).resolves.toMatchObject({ status: 403 });
    expect(getFactorRequirement()).toBeNull(); expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not publish a preflight denial or retry an original workflow after verification is requested', async () => {
    bind({ readOnly: true });
    await expect(request({ method: 'POST', path: '/api/v2/clinical/prescriptions', body: {} })).rejects.toMatchObject({ status: 403 });
    expect(globalThis.fetch).not.toHaveBeenCalled(); expect(getFactorRequirement()).toBeNull();
    bind(); globalThis.fetch.mockResolvedValueOnce(errorResponse('passkey_verification_required'));
    await expect(request({ method: 'POST', path: '/api/v2/clinical/prescriptions', body: { clinical_note: 'private-record' } })).rejects.toMatchObject({ status: 403 });
    expect(getFactorRequirement()).toBe(authorizationScope(user, getV2ClientScopeKey()));
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    dismissFactorRequirement(); await Promise.resolve(); expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not publish an error-shaped success or an unbound response', async () => {
    globalThis.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: { error: { code: 'passkey_verification_required' } } }), { headers: { 'content-type': 'application/json' } }));
    await request(); expect(getFactorRequirement()).toBeNull();
    bind({ actor: null }); globalThis.fetch.mockResolvedValueOnce(errorResponse('passkey_verification_required'));
    await expect(request()).rejects.toMatchObject({ status: 403 }); expect(getFactorRequirement()).toBeNull();
  });
});
