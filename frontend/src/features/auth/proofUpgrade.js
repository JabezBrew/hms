import { apiErrorFromEnvelope } from '@/lib/api/v2/errors';
import { buildV2ApiUrl } from '@/lib/api/v2/runtime';
import { confirmedNetworkDecision } from '@/features/settings/network/api';
import { hasFreshPasskey } from './model';

function claims(token) {
  try { const segments = token.split('.'); if (segments.length !== 3 || !segments[1]) return null; const encoded = segments[1].replace(/-/g, '+').replace(/_/g, '/'); return JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '='))); } catch { return null; }
}
export const usesPasswordConfirmation = user => user?.auth_security?.passkey_required === false && user?.auth_security?.passkey_enrolled === false;
export async function dispatchCurrentSessionProof(user, password, api, { signal, current }) {
  current();
  const ordinary = usesPasswordConfirmation(user.accessContext);
  let result, dispatchStartedAt;
  if (ordinary) { const proof = await api.confirmCurrentPassword(password, { signal }); current(); result = proof.result; dispatchStartedAt = proof.dispatchStartedAt; }
  else {
    const { browserCeremony } = await import('./ceremony'); current();
    const options = await api.factorApi.stepUpOptions(password, { signal }); current();
    const assertion = await browserCeremony(options, { signal }); current();
    result = await api.factorApi.stepUpVerify(assertion, { signal }); current();
  }
  return { result, ordinary, dispatchStartedAt };
}
const stable = value => JSON.stringify(value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(stable(value[key]))])) : value);
function factorEvidence(value) {
  if (!value || Object.keys(value).length !== 4 || !['method', 'verified_at', 'expires_at', 'credential_id'].every(key => Object.hasOwn(value, key))) return false;
  if (value.method === null) return Object.values(value).every(item => item === null);
  const start = Date.parse(value.verified_at); const end = Date.parse(value.expires_at);
  return ['passkey', 'recovery'].includes(value.method) && typeof value.verified_at === 'string' && typeof value.expires_at === 'string' && Number.isFinite(start) && Number.isFinite(end) && end > start && end <= start + 900000
    && (value.method === 'recovery' ? value.credential_id === null : /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.credential_id));
}
// Valid token application and optional draft continuity are separate decisions.
// Password proof never introduces or extends factor evidence.
export function ordinarySessionProof(current, next, oldToken, newToken, dispatchStartedAt) {
  const reject = () => { throw new Error('The current-session password proof could not be confirmed. Restart confirmation.'); };
  const old = claims(oldToken); const fresh = claims(newToken); const access = current?.accessContext;
  if (!usesPasswordConfirmation(access) || !usesPasswordConfirmation(next?.user) || typeof next.user.password_change_required !== 'boolean' || !old || !fresh || typeof old.session_id !== 'string' || !old.session_id || old.session_id !== fresh.session_id) return reject();
  const now = Date.now() / 1000;
  if (!Number.isSafeInteger(dispatchStartedAt) || dispatchStartedAt < 0 || dispatchStartedAt > Date.now() + 2000 || fresh.auth_time < Math.floor(dispatchStartedAt / 1000) - 2) return reject();
  for (const value of [old, fresh]) if (![value.iat, value.auth_time, value.exp].every(item => Number.isSafeInteger(item) && item >= 0) || value.iat > now + 2 || value.auth_time > value.iat || value.exp <= now || value.exp <= value.iat) return reject();
  if (fresh.iat < old.iat || fresh.auth_time < old.auth_time) return reject();
  for (const [key, value] of Object.entries({ sub: current.id, facility_id: access.facility_id, active_profile: access.active_profile, permission_version: access.permission_version, session_version: access.session_version })) if (old[key] !== value || fresh[key] !== value) return reject();
  const before = access.auth_security; const after = next.user.auth_security;
  for (const value of [before, after]) if (!['privileged_user', 'passkey_required', 'passkey_enrolled', 'privileged_actions_allowed'].every(key => typeof value[key] === 'boolean') || !['factor_version', 'recovery_codes_remaining'].every(key => Number.isSafeInteger(value[key]) && value[key] >= 0)) return reject();
  const security = value => Object.fromEntries(Object.entries(value).filter(([key]) => !['session_assurance', 'assurance_version', 'privileged_actions_allowed'].includes(key)));
  if (![before.assurance_version, after.assurance_version].every(value => Number.isSafeInteger(value) && value >= 0) || after.assurance_version <= before.assurance_version || stable(security(before)) !== stable(security(after)) || Boolean(current.passwordChangeRequired) !== Boolean(next.user.password_change_required)) return reject();
  const prior = before.session_assurance; const proof = after.session_assurance;
  if (!factorEvidence(prior) || !factorEvidence(proof)) return reject();
  if (stable(prior) === stable(proof)) return proof.method === null || Date.now() < Date.parse(proof.expires_at);
  // JWT iat is whole seconds; a cleared proof that expired in that same second
  // is an ordinary server downgrade, never a continuity or factor upgrade.
  if (proof.method === null && prior.method !== null && Math.floor(Date.parse(prior.expires_at) / 1000) <= fresh.iat) return false;
  return reject();
}
export function sameProofSession(current, next, oldToken, newToken, passwordConfirmed) {
  const old = claims(oldToken); const fresh = claims(newToken); const access = current?.accessContext;
  if (!hasFreshPasskey(next?.user?.auth_security?.session_assurance)) return false;
  if (!old || !fresh || !old.session_id || old.session_id !== fresh.session_id || old.exp * 1000 <= Date.now() || fresh.exp * 1000 <= Date.now()) return false;
  for (const [claim, value] of Object.entries({ sub: current.id, facility_id: access.facility_id, active_profile: access.active_profile, permission_version: access.permission_version, session_version: access.session_version })) if (old[claim] !== value || fresh[claim] !== value) return false;
  if (![old.auth_time, fresh.auth_time].every((value) => Number.isSafeInteger(value) && value <= Date.now() / 1000 + 2) || (!passwordConfirmed && fresh.auth_time !== old.auth_time) || fresh.auth_time < old.auth_time) return false;
  const priorVersion = access?.auth_security?.assurance_version; const nextVersion = next.user.auth_security?.assurance_version;
  if (priorVersion !== undefined && (!Number.isSafeInteger(priorVersion) || !Number.isSafeInteger(nextVersion) || nextVersion < priorVersion)) return false;
  const security = (user) => Object.fromEntries(Object.entries(user?.auth_security || {}).filter(([key]) => !['session_assurance', 'assurance_version', 'privileged_actions_allowed'].includes(key)).sort(([a], [b]) => a.localeCompare(b)));
  if (JSON.stringify(security(access)) !== JSON.stringify(security(next.user)) || Boolean(current.passwordChangeRequired) !== Boolean(next.user.password_change_required)) return false;
  return true;
}
export function sameReadableNetwork(previous, next) {
  return previous && next?.access_allowed === true && next.classification !== 'unknown' && next.policy_version !== null
    && ['policy_version', 'classification', 'provenance', 'mode', 'access_allowed', 'read_only', 'reauth_required'].every((key) => previous[key] === next[key]);
}
// Fixed exact read only, using the returned same-session token before publishing
// it. No arbitrary URL, refresh, workflow mutation or persistent token receipt.
export async function stageProofNetwork(token, facilityCode, { signal } = {}) {
  const response = await fetch(buildV2ApiUrl('/auth/network-access'), { method: 'GET', credentials: 'include', cache: 'no-store', headers: { Authorization: `Bearer ${token}`, 'X-Facility-Code': facilityCode }, signal });
  const envelope = await response.json();
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (!response.ok) throw apiErrorFromEnvelope(response.status, envelope);
  return confirmedNetworkDecision(envelope?.data);
}
