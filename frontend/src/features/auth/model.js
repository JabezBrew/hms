const validTime = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const nonempty = (value) => typeof value === 'string' && value.length > 0;
export function authenticatedResult(value) {
  const user = value?.user;
  if (!nonempty(value?.access_token) || value.token_type !== 'Bearer' || !Number.isSafeInteger(value.expires_in_seconds) || value.expires_in_seconds <= 0
    || !nonempty(user?.id) || !nonempty(user.email) || !nonempty(user.facility_id) || !nonempty(user.facility_code) || !nonempty(user.active_profile)
    || !['permissions', 'features', 'patient_visibility'].every((key) => Array.isArray(user[key]) && user[key].every((item) => typeof item === 'string'))) {
    throw new Error('The authenticated sign-in response could not be confirmed. Restart sign-in.');
  }
  return value;
}
export function loginResult(value) {
  if (value?.status === 'authenticated') return authenticatedResult(value);
  if (!['factor_required', 'setup_required'].includes(value?.status) || !nonempty(value.login_grant) || !validTime(value.expires_at)
    || Date.parse(value.expires_at) <= Date.now() || Object.keys(value).some((key) => !['status', 'login_grant', 'expires_at', 'methods', 'reason'].includes(key))) throw new Error('The sign-in challenge could not be confirmed. Restart sign-in.');
  if (value.status === 'factor_required' && (typeof value.methods?.passkey !== 'boolean' || typeof value.methods?.recovery_code !== 'boolean' || (!value.methods.passkey && !value.methods.recovery_code))) throw new Error('No supported sign-in factor was returned. Restart sign-in or contact your administrator.');
  if (value.status === 'setup_required' && value.reason !== 'operator_bootstrap_required') throw new Error('Account setup could not be confirmed. Contact your administrator.');
  return value;
}
export function assuranceResult(value) {
  const proof = value?.assurance;
  if (!proof || !validTime(value.password_verified_at) || !validTime(value.password_fresh_until)
    || (proof.method !== null && !['passkey', 'recovery'].includes(proof.method))
    || (proof.method !== null && (!validTime(proof.verified_at) || !validTime(proof.expires_at) || Date.parse(proof.expires_at) <= Date.parse(proof.verified_at)))) throw new Error('Current factor assurance could not be confirmed.');
  return value;
}
export const hasFreshPasskey = (value, now = Date.now()) => value?.method === 'passkey' && typeof value.credential_id === 'string' && Date.parse(value.verified_at) <= now && now < Date.parse(value.expires_at) && Date.parse(value.expires_at) <= Date.parse(value.verified_at) + 900000;
export function sameSessionIdentity(current, result) {
  const user = authenticatedResult(result).user; const access = current?.accessContext;
  if (current?.id !== user.id || access?.facility_id !== user.facility_id || access?.active_profile !== user.active_profile
    || current.facilityCode !== user.facility_code || access.session_version !== user.session_version || access.permission_version !== user.permission_version
    || ['permissions', 'features', 'patient_visibility'].some((key) => JSON.stringify([...(access[key] || [])].sort()) !== JSON.stringify([...user[key]].sort()))) throw new Error('The signed-in account or access scope changed. Restart confirmation.');
  return result;
}
export function authFailure(error) {
  if (['AbortError', 'NotAllowedError'].includes(error?.name)) return 'The passkey request was cancelled or not approved. You can try again.';
  if (error?.name === 'SecurityError') return 'Passkeys are unavailable at this site address. Contact your administrator.';
  const code = error?.data?.error?.code;
  if (code?.includes('expired') || code?.includes('consumed')) return 'This sign-in request has expired or was already used. Restart sign-in.';
  if (code?.includes('budget') || error?.status === 429) return 'Too many attempts. Wait before restarting sign-in.';
  return error?.message || 'Sign-in could not be confirmed. Please try again.';
}
