import { apiErrorFromEnvelope } from '@/lib/api/v2/errors';
import { buildV2ApiUrl } from '@/lib/api/v2/runtime';
import { confirmedNetworkDecision } from '@/features/settings/network/api';
import { hasFreshPasskey } from './model';
import { clockInstant, observeNetworkDecision, tokenClaims } from './clock';
import { clockGeneration, clockNow, recordServerClockResponse, serverClock, transferServerClock } from '@/shared/lib/serverClock';
import { getV2ClientScopeKey } from '@/lib/api/v2/session';
import { currentNetworkAuthorityScope } from '@/lib/api/v2/networkAccessGuard';

function claims(token) { try { return tokenClaims(token); } catch { return null; } }
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
  try { const start = clockInstant(value.verified_at); const end = clockInstant(value.expires_at);
    return ['passkey', 'recovery'].includes(value.method) && end > start && end <= start +900000000000n
      && (value.method === 'recovery' ? value.credential_id === null : /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.credential_id));
  } catch { return false; }
}
// A valid session token, this command's proof and optional RAM continuity are
// separate outcomes. None authorizes a business retry or acknowledges a write.
export function ordinarySessionProof(current, next, oldToken, newToken) {
  const reject = () => { throw new Error('The current-session password proof could not be confirmed. Restart confirmation.'); };
  const old = claims(oldToken); const fresh = claims(newToken); const access = current?.accessContext; const clock = serverClock(next);
  if (!usesPasswordConfirmation(access) || !usesPasswordConfirmation(next?.user) || typeof next.user.password_change_required !== 'boolean' || !old || !fresh || old.session_id !== fresh.session_id || !clock || clock.token !== newToken) return reject();
  clock.assertResponse();
  if (fresh.iat < old.iat || fresh.auth_time < old.auth_time || clock.tokenRemaining() <=0) return reject();
  for (const [key, value] of Object.entries({ sub: current.id, facility_id: access.facility_id, active_profile: access.active_profile, permission_version: access.permission_version, session_version: access.session_version })) if (old[key] !== value || fresh[key] !== value) return reject();
  const before = access.auth_security; const after = next.user.auth_security;
  for (const value of [before, after]) if (!['privileged_user', 'passkey_required', 'passkey_enrolled', 'privileged_actions_allowed'].every(key => typeof value[key] === 'boolean') || !['factor_version', 'recovery_codes_remaining'].every(key => Number.isSafeInteger(value[key]) && value[key] >=0)) return reject();
  const security = value => Object.fromEntries(Object.entries(value).filter(([key]) => !['session_assurance', 'assurance_version', 'privileged_actions_allowed', 'auth_clock'].includes(key)));
  if (![before.assurance_version, after.assurance_version].every(value => Number.isSafeInteger(value) && value >=0) || after.assurance_version <= before.assurance_version || stable(security(before)) !== stable(security(after)) || Boolean(current.passwordChangeRequired) !== Boolean(next.user.password_change_required)) return reject();
  const witness = next.ordinary_confirmation;
  if (!witness || witness.assurance_version <=before.assurance_version || witness.assurance_version >after.assurance_version || witness.session_id !== fresh.session_id || witness.purpose !== 'ordinary_password_confirmation') return reject();
  const admitted = clockInstant(witness.admitted_at); const published = clockInstant(witness.published_password_verified_at);
  const canonical = Math.min(Number(published /1000000000n), fresh.iat);
  if (fresh.auth_time <canonical || (witness.assurance_version ===after.assurance_version && fresh.auth_time !==canonical)) return reject();
  if (!clock.createdDuring(witness.admitted_at)) return reject();
  const confirmed = witness.assurance_version ===after.assurance_version && admitted ===published && clock.createdDuring(witness.admitted_at);
  const prior = before.session_assurance; const proof = after.session_assurance;
  if (!factorEvidence(prior) || !factorEvidence(proof)) return reject();
  let factorCurrent;
  if (stable(prior) ===stable(proof)) factorCurrent = proof.method ===null || clock.remaining(proof.expires_at) >0;
  else if (proof.method ===null && prior.method !==null && clockInstant(prior.expires_at) <=clock.database) factorCurrent = false;
  else return reject();
  clock.assertResponse();
  return { confirmed, continuity: confirmed && factorCurrent };
}
export function sameProofSession(current, next, oldToken, newToken, passwordConfirmed) {
  const old = claims(oldToken); const fresh = claims(newToken); const access = current?.accessContext;
  const clock = serverClock(next); const priorClock = serverClock(access?.auth_security);
  if (!hasFreshPasskey(next?.user?.auth_security?.session_assurance) || !clock || !priorClock || priorClock.tokenRemaining() <=0 || clock.tokenRemaining() <=0) return false;
  if (!old || !fresh || old.session_id !==fresh.session_id) return false;
  for (const [claim, value] of Object.entries({ sub: current.id, facility_id: access.facility_id, active_profile: access.active_profile, permission_version: access.permission_version, session_version: access.session_version })) if (old[claim] !==value || fresh[claim] !==value) return false;
  if ((!passwordConfirmed && fresh.auth_time !==old.auth_time) || fresh.auth_time <old.auth_time) return false;
  const priorVersion = access?.auth_security?.assurance_version; const nextVersion = next.user.auth_security?.assurance_version;
  if (priorVersion !==undefined && (!Number.isSafeInteger(priorVersion) || !Number.isSafeInteger(nextVersion) || nextVersion <priorVersion)) return false;
  const security = user => Object.fromEntries(Object.entries(user?.auth_security || {}).filter(([key]) => !['session_assurance', 'assurance_version', 'privileged_actions_allowed', 'auth_clock'].includes(key)).sort(([a], [b]) => a.localeCompare(b)));
  if (JSON.stringify(security(access)) !==JSON.stringify(security(next.user)) || Boolean(current.passwordChangeRequired) !==Boolean(next.user.password_change_required)) return false;
  return true;
}
export function sameReadableNetwork(previous, next) {
  return previous && next?.access_allowed === true && next.classification !== 'unknown' && next.policy_version !== null
    && ['policy_version', 'classification', 'provenance', 'mode', 'access_allowed', 'read_only', 'reauth_required'].every((key) => previous[key] === next[key]);
}
// Fixed exact read only, using the returned same-session token before publishing
// it. No arbitrary URL, refresh, workflow mutation or persistent token receipt.
export async function stageProofNetwork(token, facilityCode, { signal, current = () => {} } = {}) {
  const started = clockNow(); const generation = clockGeneration(); const scope = getV2ClientScopeKey(); const authority = currentNetworkAuthorityScope();
  const response = await fetch(buildV2ApiUrl('/auth/network-access'), { method: 'GET', credentials: 'include', cache: 'no-store', headers: { Authorization: `Bearer ${token}`, 'X-Facility-Code': facilityCode }, signal });
  const envelope = await response.json(); current();
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (!response.ok) throw apiErrorFromEnvelope(response.status, envelope);
  recordServerClockResponse(envelope, { started, generation, signal, token, method: 'GET', path: '/api/v2/auth/network-access', current: () => { current(); return scope ===getV2ClientScopeKey() && authority ===currentNetworkAuthorityScope(); } });
  observeNetworkDecision(envelope?.data);
  return transferServerClock(envelope.data, confirmedNetworkDecision(envelope.data));
}
