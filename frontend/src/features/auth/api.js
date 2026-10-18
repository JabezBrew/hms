import { apiErrorFromEnvelope } from '@/lib/api/v2/errors';
import { buildV2ApiUrl } from '@/lib/api/v2/runtime';
import { v2Request } from '@/lib/api/v2/session';
import { authenticatedResult, assuranceResult, hasFreshPasskey, loginResult } from './model';

const grantPaths = new Set(['/auth/login', '/auth/setup/start', '/auth/login/passkey/options', '/auth/login/passkey/verify', '/auth/login/recovery', '/auth/login/setup/options', '/auth/login/setup/verify']);
// These endpoints exchange a restricted login grant. It is never a bearer token,
// and an old cookie must not trigger an automatic refresh/retry of this command.
export async function grantRequest(path, body, { signal } = {}) {
  if (!grantPaths.has(path)) throw new Error('Unsupported sign-in operation.');
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const response = await fetch(buildV2ApiUrl(path), { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  let envelope;
  try { envelope = await response.json(); } catch { throw new Error('The sign-in response could not be read. Restart sign-in.'); }
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (!response.ok) throw apiErrorFromEnvelope(response.status, envelope);
  if (!envelope || !('data' in envelope)) throw new Error('The sign-in response could not be confirmed. Restart sign-in.');
  return envelope.data;
}
async function ownRequest(path, { method = 'GET', body, signal, query } = {}) {
  const response = await v2Request({ method, path, body, signal, query }); return response?.data;
}
const keyPath = (id) => { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error('Select a saved passkey.'); return `/api/v2/auth/mfa/passkeys/${id}`; };
export async function confirmCurrentPassword(password, { signal } = {}) {
  if (typeof password !== 'string' || !password.length) throw new Error('Enter your current password.');
  const { createGeneratedClient } = await import('@/lib/api/v2/generated/client');
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  // The generated options intentionally expose no refresh selector. Use its
  // actual operation with a fixed no-refresh transport for this credential proof.
  const client = createGeneratedClient(request => v2Request({ ...request, skipAuthRefresh: true }));
  const dispatchStartedAt = Date.now();
  const response = await client.postAuthReauthenticate({ current_password: password }, { signal });
  if (response?.data?.status !== 'authenticated') throw new Error('Current identity could not be confirmed.');
  return { result: authenticatedResult(response.data), dispatchStartedAt };
}
export const factorApi = {
  login: async (body, options) => loginResult(await grantRequest('/auth/login', body, options)),
  startSetup: async (body, options) => { const result = loginResult(await grantRequest('/auth/setup/start', body, options)); if (result.status !== 'setup_required') throw new Error('First-key setup could not be confirmed.'); return result; },
  options: (grant, options) => grantRequest('/auth/login/passkey/options', { login_grant: grant }, options),
  verify: async (body, options) => factorResult(await grantRequest('/auth/login/passkey/verify', body, options), 'passkey'),
  recovery: async (grant, code, options) => factorResult(await grantRequest('/auth/login/recovery', { login_grant: grant, code }, options), 'recovery'),
  setupOptions: (grant, bootstrap, options) => grantRequest('/auth/login/setup/options', { login_grant: grant, bootstrap_token: bootstrap }, options),
  setupVerify: async (body, options) => { const result = loginResult(await grantRequest('/auth/login/setup/verify', body, options)); if (result.status !== 'factor_required') throw new Error('Passkey setup did not return the required separate assertion. Restart sign-in.'); return result; },
  assurance: async (options) => assuranceResult(await ownRequest('/api/v2/auth/assurance', options)),
  stepUpOptions: (password, options) => ownRequest('/api/v2/auth/assurance/options', { ...options, method: 'POST', body: { ...(password ? { current_password: password } : {}) } }),
  stepUpVerify: async (body, options) => factorResult(await ownRequest('/api/v2/auth/assurance/verify', { ...options, method: 'POST', body }), 'passkey'),
  keys: async ({ cursor, signal } = {}) => {
    const response = await v2Request({ path: '/api/v2/auth/mfa/passkeys', query: { limit: 10, ...(cursor ? { cursor } : {}) }, signal });
    const rows = response?.data; const page = response?.page;
    if (!Array.isArray(rows) || rows.length > 10 || rows.some((row) => !row?.id || !validKey(row)) || new Set(rows.map((row) => row.id)).size !== rows.length || typeof page?.has_next !== 'boolean' || (page.has_next && (!page.next_cursor || page.next_cursor === cursor))) throw new Error('The passkey list could not be confirmed.');
    return { rows, ...page };
  },
  rename: async (id, label, options) => ownRequest(keyPath(id), { ...options, method: 'PATCH', body: { label: label.trim() } }),
  disable: async (id, options) => ownRequest(`${keyPath(id)}/disable`, { ...options, method: 'POST', body: {} }),
};
function validKey(row) { try { keyPath(row.id); return typeof row.created_at === 'string' && (row.label === null || typeof row.label === 'string') && (row.disabled_at === null || typeof row.disabled_at === 'string'); } catch { return false; } }
function factorResult(value, method) {
  const result = authenticatedResult(value); const assurance = result.user.auth_security?.session_assurance;
  if (result.status !== 'authenticated' || assurance?.method !== method || (method === 'passkey' && !hasFreshPasskey(assurance))) throw new Error('The verified sign-in proof could not be confirmed. Restart verification.');
  return result;
}
