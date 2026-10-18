import { apiErrorFromEnvelope } from './errors';
import { invalidateWriteRecoveryReads } from './writeUncertainty';

// Keep exact method/route templates aligned with the Rust network middleware.
const AUTH_POSTS = new Set(['/api/v2/auth/login', '/api/v2/auth/refresh', '/api/v2/auth/logout', '/api/v2/auth/password',
  '/api/v2/auth/password-reset/request', '/api/v2/auth/password-reset/complete', '/api/v2/auth/sessions/revoke-all', '/api/v2/auth/sessions/:session_id/revoke',
  '/api/v2/auth/mfa/webauthn/register/options', '/api/v2/auth/mfa/webauthn/register/verify', '/api/v2/auth/mfa/webauthn/authenticate/options', '/api/v2/auth/mfa/webauthn/authenticate/verify', '/api/v2/auth/mfa/recovery-codes',
  '/api/v2/auth/assurance/options', '/api/v2/auth/assurance/verify', '/api/v2/auth/reauthenticate', '/api/v2/auth/mfa/passkeys/:id/disable']);
const READ_POSTS = new Set(['/api/v2/patients/search', '/api/v2/patients/:patient_id/clinical/note-template-previews', '/api/v2/patients/context/search', '/api/v2/wards/board/search', '/api/v2/search/omni',
  '/api/v2/appointments/search', '/api/v2/encounters/search', '/api/v2/admin/audit-events/search',
  '/api/v2/laboratory/orders/search', '/api/v2/laboratory/results/search', '/api/v2/billing/patient-insurances/search', '/api/v2/billing/invoices/search',
  '/api/v2/billing/payment-intents/search', '/api/v2/billing/settlements/search', '/api/v2/billing/settlements/:id/lines/search', '/api/v2/billing/payments/search',
  '/api/v2/nhis/claims/search', '/api/v2/nhis/remittance-imports/:id/lines/search']);
let enabled = false; let active = null;
const subscribers = new Set();
const notify = () => subscribers.forEach((subscriber) => subscriber());
function routeTemplate(path) {
  path = String(path || '');
  const full = path.startsWith('/api/v2/') ? path : `/api/v2${path.startsWith('/') ? '' : '/'}${path}`;
  return full.replace(/\{([a-z_]+)\}/g, ':$1')
    .replace(/^(\/api\/v2\/patients\/)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\/clinical\/note-template-previews)$/i, '$1:patient_id$2')
    .replace(/^(\/api\/v2\/auth\/sessions\/)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\/revoke)$/i, '$1:session_id$2')
    .replace(/^(\/api\/v2\/auth\/mfa\/passkeys\/)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\/disable)?$/i, '$1:id$2')
    .replace(/^(\/api\/v2\/billing\/settlements\/)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\/lines\/search)$/i, '$1:id$2')
    .replace(/^(\/api\/v2\/nhis\/remittance-imports\/)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\/lines\/search)$/i, '$1:id$2');
}
function writeError(code = 'network_access_unconfirmed') { return apiErrorFromEnvelope(403, { error: { code, message: 'The current connection does not have confirmed permission to change workflows. Review the network access notice before continuing.' } }); }
function freshWritable(binding) {
  const value = binding?.decision;
  if (!binding?.confirmed || !value?.access_allowed || value.read_only || value.classification === 'unknown' || value.policy_version === null) return false;
  return !(value.classification === 'offsite' && value.mode === 'fresh_reauth') || (Number.isFinite(Date.parse(value.reauth_expires_at)) && Date.now() < Date.parse(value.reauth_expires_at));
}
export function bindNetworkAccessGuard({ transportScope, authorityScope, principal }) {
  enabled = true; const binding = { transportScope, authorityScope, principal, confirmed: false, decision: null }; active = binding; notify();
  return { update(snapshot) { if (active === binding) { Object.assign(binding, snapshot); if (binding.confirmed && binding.decision?.access_allowed === false) { try { invalidateWriteRecoveryReads(); } catch { /* Access denial must not depend on recovery storage. */ } } notify(); } }, release() { if (active === binding) { active = null; notify(); } } };
}
export const currentNetworkAuthorityScope = () => active?.authorityScope || null;
export const currentNetworkPrincipal = () => active?.principal || null;
export function currentConfirmedNetworkDecision(transportScope, authorityScope) {
  if (!active?.confirmed || active.transportScope !== transportScope || active.authorityScope !== authorityScope) return null;
  const value = active.decision;
  if (!value?.access_allowed || value.classification === 'unknown' || value.policy_version === null) return null;
  if (value.classification === 'offsite' && value.mode === 'fresh_reauth' && !(Date.now() < Date.parse(value.reauth_expires_at))) return null;
  return value;
}
function ownSecurityOperation(verb, route) { return (verb === 'POST' && AUTH_POSTS.has(route)) || (verb === 'PATCH' && route === '/api/v2/auth/mfa/passkeys/:id'); }
export function isNetworkWorkflowWrite(method, path) { const verb = method.toUpperCase(); const route = routeTemplate(path); return enabled && !['GET', 'HEAD', 'OPTIONS'].includes(verb) && !ownSecurityOperation(verb, route) && !(verb === 'POST' && (READ_POSTS.has(route) || route === '/api/v2/observability/rum')); }
export function assertNetworkRequestAllowed({ method, path, transportScope }) {
  const verb = method.toUpperCase(); const route = routeTemplate(path);
  if (['GET', 'HEAD', 'OPTIONS'].includes(verb) || ownSecurityOperation(verb, route) || !enabled) return;
  if (!active?.confirmed || active.transportScope !== transportScope) throw writeError();
  if (!active.decision?.access_allowed) throw writeError('network_access_denied');
  if (verb === 'POST' && READ_POSTS.has(route)) return;
  if (!freshWritable(active)) throw writeError(active.decision?.reauth_required ? 'network_reauth_required' : 'network_read_only');
}
function waitForBinding({ transportScope, authorityScope, signal, assertAllowed }) {
  if (!enabled) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => { subscribers.delete(check); signal?.removeEventListener('abort', abort); window.clearTimeout(timer); };
    const abort = () => { cleanup(); reject(new DOMException('Aborted', 'AbortError')); };
    const check = () => {
      if (signal?.aborted) { abort(); return; }
      if (active?.transportScope !== transportScope || active?.authorityScope !== authorityScope || !active.confirmed) return;
      cleanup(); try { assertAllowed(); resolve(); } catch (error) { reject(error); }
    };
    subscribers.add(check); signal?.addEventListener('abort', abort, { once: true });
    timer = window.setTimeout(() => { cleanup(); reject(writeError()); }, 5000); check();
  });
}
export function waitForNetworkWriteAccess(options) { return waitForBinding({ ...options, assertAllowed: () => { if (!freshWritable(active)) throw writeError(); } }); }
export function waitForNetworkRequestAccess({ method, path, ...options }) {
  const verb = method.toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(verb) || ownSecurityOperation(verb, routeTemplate(path))) return Promise.resolve();
  return waitForBinding({ ...options, assertAllowed: () => assertNetworkRequestAllowed({ method, path, transportScope: options.transportScope }) });
}
export function resetNetworkAccessGuardForTests() { enabled = false; active = null; subscribers.clear(); }
