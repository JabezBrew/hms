import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useNetworkRequestGuard } from '@/features/settings/network/useNetworkRequestGuard';
import { providerUser } from '@/features/auth/providerUser';
import { adaptV2AuthTokenResponse } from '@/lib/api/auth';
import { clockToken } from '@/features/auth/__tests__/clock-fixtures';
import { configureV2ApiClient, __resetV2ApiClientForTests, getV2ClientScopeKey, v2Request } from '../session';
import { currentNetworkAuthorityScope } from '../networkAccessGuard';
import { isCurrentReadDenial } from '../readDenials';
// Deliberately collide ONLY the existing identity/query digest projection in this
// isolated contract control. This is not a demonstrated64-bit hash exploit. The
// production hook, owner projection, guard, fetch and error witness remain real;
// exact private owner values must distinguish these controlled equal digests.
vi.mock('@/shared/lib/privateQueryKey', () => ({ hashQueryValue: () => 'controlled-colliding-digest' }));
const runtime = window.__HMS_RUNTIME_CONFIG__;
const path = '/api/v2/notifications/counts';
let bearer, user, response;
const configure = () => configureV2ApiClient({ getAccessToken: () => bearer, getFacilityCode: () => 'HMS', canRefreshSession: () => false });
beforeEach(() => {
  __resetV2ApiClientForTests(); window.__HMS_RUNTIME_CONFIG__ = { apiMode: 'rust-v2', v2ApiBaseUrl: 'http://localhost/api/v2' };
  const raw = clockToken(); bearer = raw.access_token; user = providerUser(adaptV2AuthTokenResponse({ data: raw }), 'HMS'); configure();
  response = new Response(JSON.stringify({ error: { code: 'permission_denied', message: 'Synthetic denied optional read' } }), { status: 403, headers: { 'content-type': 'application/json' } });
  vi.stubGlobal('fetch', vi.fn(async () => response));
});
afterEach(() => { cleanup(); __resetV2ApiClientForTests(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.__HMS_RUNTIME_CONFIG__ = runtime; });
function mount() { return renderHook(({ value, snapshot }) => useNetworkRequestGuard(value, snapshot), { initialProps: { value: user, snapshot: { confirmed: true, decision: null } } }); }
async function denied() { try { await v2Request({ path }); throw new Error('Expected actual HTTP403'); } catch (error) { expect(error.status).toBe(403); return error; } }
function changed(value, field) {
  const next = structuredClone(value);
  if (field === 'permissions') next.adminAccess.capabilities.push('notification.view');
  else if (field === 'features') next.accessContext.features.push('dashboards');
  else if (field === 'patient_visibility') next.accessContext.patient_visibility.push('full_clinical');
  else if (field === 'session_assurance') next.accessContext.auth_security.session_assurance = { method: 'password', verified_at: '2026-10-18T10:00:00Z', expires_at: '2026-10-18T10:15:00Z' };
  else if (field === 'privileged_actions_allowed') next.accessContext.auth_security[field] = !next.accessContext.auth_security[field];
  else next.accessContext.auth_security[field] += 1;
  return next;
}
it.each(['assurance_version', 'factor_version', 'permissions', 'features', 'patient_visibility', 'privileged_actions_allowed', 'session_assurance'])('actual binder rejects sameJWT %s A→B→A despite controlled equal authority digests', async field => {
  const view = mount(), originalBearer = bearer, originalAuthority = currentNetworkAuthorityScope(), originalTransport = getV2ClientScopeKey();
  let releaseBody, enteredBody; const entered = new Promise(resolve => { enteredBody = resolve; });
  response.json = () => { enteredBody(); return new Promise(resolve => { releaseBody = () => resolve({ error: { code: 'permission_denied' } }); }); };
  const pending = denied(); await entered;
  view.rerender({ value: changed(user, field), snapshot: { confirmed: false, decision: null } });
  expect(currentNetworkAuthorityScope()).toBe(originalAuthority);
  view.rerender({ value: user, snapshot: { confirmed: true, decision: null } }); releaseBody();
  expect(bearer).toBe(originalBearer); expect(getV2ClientScopeKey()).toBe(originalTransport); expect(isCurrentReadDenial(await pending)).toBe(false);
});
it('actual binder keeps canonical same-owner clock/checking/configuration changes stable', async () => {
  const view = mount(), error = await denied(); expect(isCurrentReadDenial(error)).toBe(true);
  const same = structuredClone(user); same.adminAccess.capabilities.reverse(); same.accessContext.features.reverse(); same.accessContext.patient_visibility.reverse();
  same.accessContext.auth_security = Object.fromEntries(Object.entries(same.accessContext.auth_security).reverse());
  same.accessContext.auth_security.auth_clock = { database_observed_at: '2040-01-01T00:00:00Z', issuer_observed_at: '2039-12-31T23:59:59Z', access_token_remaining_ms: 1 };
  view.rerender({ value: same, snapshot: { confirmed: false, decision: null } }); act(configure);
  view.rerender({ value: same, snapshot: { confirmed: true, decision: null } }); expect(isCurrentReadDenial(error)).toBe(true);
});
it('actual binder captures immutable owner values and observes an in-place mutation only when committed', async () => {
  const view = mount(), error = await denied(); expect(isCurrentReadDenial(error)).toBe(true);
  user.accessContext.auth_security.assurance_version += 1;
  expect(isCurrentReadDenial(error)).toBe(true);
  view.rerender({ value: user, snapshot: { confirmed: true, decision: null } }); expect(isCurrentReadDenial(error)).toBe(false);
});
it('actual binder cannot accept a changed raw bearer that collides in the legacy transport scope hash', async () => {
  bearer += 'Aa'; configure(); mount(); const originalScope = getV2ClientScopeKey(), error = await denied(); expect(isCurrentReadDenial(error)).toBe(true);
  bearer = `${bearer.slice(0, -2)}BB`; act(configure); expect(getV2ClientScopeKey()).toBe(originalScope); expect(isCurrentReadDenial(error)).toBe(false);
});
