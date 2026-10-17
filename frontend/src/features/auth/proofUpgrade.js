import { apiErrorFromEnvelope } from '@/lib/api/v2/errors';
import { buildV2ApiUrl } from '@/lib/api/v2/runtime';
import { confirmedNetworkDecision } from '@/features/settings/network/api';
import { hasFreshPasskey } from './model';

function claims(token) {
  try { const segments = token.split('.'); if (segments.length !== 3 || !segments[1]) return null; const encoded = segments[1].replace(/-/g, '+').replace(/_/g, '/'); return JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '='))); } catch { return null; }
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
