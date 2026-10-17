// Only opaque scope hashes and a coarse, address-free network decision live here.
// Request transport and dispatch authority never consult this registry.
let current = null;
let expiryTimer = null;
const listeners = new Set();
export const subscribeWorkflowContinuity = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
export const getWorkflowContinuity = () => current;
const live = () => current && current.until > Date.now() ? current : null;
const matches = (value, scope) => value && (value.target === scope || value.source === scope);
export function workflowScope(strictScope) { const value = live(); return matches(value, strictScope) ? value.workflow : strictScope; }
export function workflowIdentityKey(strictScope, identityHash) { const value = live(); return matches(value, strictScope) ? value.identity : identityHash; }
export function installWorkflowContinuity({ source, target, sourceIdentity, until, stagedDecision }) {
  if (![source, target, sourceIdentity].every((value) => typeof value === 'string' && /^[a-z0-9]+$/i.test(value)) || !Number.isFinite(until) || until <= Date.now()) return false;
  if (!stagedDecision?.access_allowed || !['onsite', 'offsite'].includes(stagedDecision.classification) || !Number.isSafeInteger(stagedDecision.policy_version) || stagedDecision.policy_version < 1) return false;
  const workflow = workflowScope(source); const identity = workflowIdentityKey(source, sourceIdentity);
  const allowed = ['classification', 'provenance', 'policy_version', 'mode', 'access_allowed', 'read_only', 'reauth_required', 'reauth_expires_at', 'evaluated_at', 'reason'];
  current = Object.freeze({ source, target, workflow, identity, until: Math.min(until, Date.now() + 900000), stagedUntil: Math.min(until, Date.now() + 5000), stagedDecision: Object.freeze(Object.fromEntries(allowed.map((key) => [key, stagedDecision[key]]))) });
  window.clearTimeout(expiryTimer); expiryTimer = window.setTimeout(clearWorkflowContinuity, current.until - Date.now());
  listeners.forEach((listener) => listener()); return true;
}
export function stagedNetworkDecision(strictScope) { const value = live(); return value?.target === strictScope && value.stagedUntil > Date.now() ? value.stagedDecision : null; }
export function clearWorkflowContinuity() { window.clearTimeout(expiryTimer); expiryTimer = null; if (!current) return; current = null; listeners.forEach((listener) => listener()); }
