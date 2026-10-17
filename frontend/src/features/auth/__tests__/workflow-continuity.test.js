import { afterEach, expect, it, vi } from 'vitest';
import { adaptV2AuthTokenResponse } from '@/lib/api/auth';
import { providerUser } from '../providerUser';
import { sameProofSession } from '../proofUpgrade';
import { authorizationIdentity, authorizationScope, requestAuthorizationScope, workflowAuthorizationIdentity } from '@/shared/lib/authorizationScope';
import { clearWorkflowContinuity, getWorkflowContinuity, installWorkflowContinuity, stagedNetworkDecision } from '@/shared/lib/workflowContinuity';
import { configureV2ApiClient, getV2ClientScopeForToken, getV2ClientScopeKey, __resetV2ApiClientForTests, v2Request } from '@/lib/api/v2/session';
import { bindNetworkAccessGuard } from '@/lib/api/v2/networkAccessGuard';
import { hashQueryValue } from '@/shared/lib/privateQueryKey';
import { token, jwtFor, networkDecision as decision } from './fixtures';
afterEach(() => { clearWorkflowContinuity(); vi.useRealTimers(); });
it('keeps workflow identity only after explicit same-session proof while actual request scopes change', () => {
  const before = token('passkey'); const next = token('passkey'); next.user.auth_security.session_assurance.verified_at = new Date(Date.now()).toISOString(); const actor = providerUser(adaptV2AuthTokenResponse({ data: before })); const upgraded = providerUser(adaptV2AuthTokenResponse({ data: next }));
  const oldTransport = getV2ClientScopeForToken(jwtFor(before), 'HMS'); const newTransport = getV2ClientScopeForToken(jwtFor(next, { auth_time: Math.floor(Date.now() / 1000) }), 'HMS');
  const source = requestAuthorizationScope(actor, oldTransport); const target = requestAuthorizationScope(upgraded, newTransport);
  expect(sameProofSession(actor, next, jwtFor(before), jwtFor(next), false)).toBe(true);
  expect(installWorkflowContinuity({ source, target, sourceIdentity: hashQueryValue(authorizationIdentity(actor)), until: Date.now() + 600000, stagedDecision: decision() })).toBe(true);
  expect(authorizationScope(upgraded, newTransport)).toBe(authorizationScope(actor, oldTransport)); expect(requestAuthorizationScope(upgraded, newTransport)).not.toBe(source); expect(newTransport).not.toBe(oldTransport);
  expect(workflowAuthorizationIdentity(upgraded, newTransport)).toBe(workflowAuthorizationIdentity(actor, oldTransport)); expect(authorizationIdentity(upgraded)).not.toBe(authorizationIdentity(actor));
  const stored = JSON.stringify(getWorkflowContinuity()); for (const value of [actor.id, actor.email, actor.facilityCode, jwtFor(before), 'session_assurance']) expect(stored).not.toContain(value);
});
it.each([{ factor_version: 2 }, { passkey_enrolled: false }, { recovery_codes_remaining: 2 }, { passkey_required: true }])('does not preserve changed nonfactor security facts %j', (change) => { const before = token('passkey'); const actor = providerUser(adaptV2AuthTokenResponse({ data: before })); const next = token('passkey'); Object.assign(next.user.auth_security, change); expect(sameProofSession(actor, next, jwtFor(before), jwtFor(next), false)).toBe(false); });
it('allows only the same-session assurance revision to advance during the verified proof handoff', () => { const before = token('passkey'); const actor = providerUser(adaptV2AuthTokenResponse({ data: before })); const next = token('passkey'); next.user.auth_security.assurance_version += 1; expect(sameProofSession(actor, next, jwtFor(before), jwtFor(next), false)).toBe(true); next.user.auth_security.assurance_version = 0; expect(sameProofSession(actor, next, jwtFor(before), jwtFor(next), false)).toBe(false); });
it('rejects another session, stale proof or implicit password-time advancement', () => { const before = token('passkey'); const actor = providerUser(adaptV2AuthTokenResponse({ data: before })); const next = token('passkey'); expect(sameProofSession(actor, next, jwtFor(before), jwtFor(next, { session_id: 'different-session' }), false)).toBe(false); expect(sameProofSession(actor, next, jwtFor(before), jwtFor(next, { auth_time: Math.floor(Date.now() / 1000) }), false)).toBe(false); next.user.auth_security.session_assurance.expires_at = new Date(Date.now() - 1).toISOString(); expect(sameProofSession(actor, next, jwtFor(before), jwtFor(next), true)).toBe(false); });
it('bounds the exact staged proof to five seconds and removes continuity on expiry', async () => { vi.useFakeTimers(); installWorkflowContinuity({ source: 'old', target: 'new', sourceIdentity: 'identity', until: Date.now() + 10000, stagedDecision: decision() }); expect(stagedNetworkDecision('new')).not.toBeNull(); expect(stagedNetworkDecision('other')).toBeNull(); await vi.advanceTimersByTimeAsync(5000); expect(stagedNetworkDecision('new')).toBeNull(); await vi.advanceTimersByTimeAsync(5000); expect(getWorkflowContinuity()).toBeNull(); });
it('cannot dispatch in the first frame before the exact new-token request guard is bound', async () => {
  const runtime = window.__HMS_RUNTIME_CONFIG__; const oldFetch = globalThis.fetch; let currentToken = 'synthetic-original';
  try {
    window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost/api/v2' }; __resetV2ApiClientForTests(); configureV2ApiClient({ getAccessToken: () => currentToken, getFacilityCode: () => 'HMS' }); globalThis.fetch = vi.fn();
    const actor = providerUser(adaptV2AuthTokenResponse({ data: token('passkey') })); const source = requestAuthorizationScope(actor, getV2ClientScopeKey()); const binding = bindNetworkAccessGuard({ transportScope: getV2ClientScopeKey(), authorityScope: authorizationIdentity(actor) }); binding.update({ confirmed: true, decision: decision() });
    currentToken = 'synthetic-new-actual-token'; const target = requestAuthorizationScope(actor, getV2ClientScopeKey()); installWorkflowContinuity({ source, target, sourceIdentity: hashQueryValue(authorizationIdentity(actor)), until: Date.now() + 10000, stagedDecision: decision() });
    expect(authorizationScope(actor, getV2ClientScopeKey())).toBe(source);
    await expect(v2Request({ method: 'POST', path: '/api/v2/clinical/prescriptions', body: {} })).rejects.toMatchObject({ status: 403, data: { error: { code: 'network_access_unconfirmed' } } }); expect(fetch).not.toHaveBeenCalled();
  } finally { __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = runtime; globalThis.fetch = oldFetch; }
});
