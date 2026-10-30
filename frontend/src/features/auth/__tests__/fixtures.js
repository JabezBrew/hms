let latestToken = null;
export const actor = '99999999-0000-4000-8000-000000000001';
export const facility = '99999999-0000-4000-8000-000000000002';
export const keyId = '99999999-0000-4000-8000-000000000003';
export const challengeId = '99999999-0000-4000-8000-000000000004';
export function token(method = null, changes = {}) {
  // One server response has one proof instant. Separate Date.now() calls can
  // cross a millisecond and accidentally exceed the strict fifteen-minute cap.
  const now = Date.now();
  const value = { status: 'authenticated', access_token: 'synthetic-access-token', token_type: 'Bearer', expires_in_seconds: 600,
    session_idle_expires_at: new Date(now + 1800000).toISOString(), session_absolute_expires_at: new Date(now + 28800000).toISOString(),
    user: { id: actor, email: 'synthetic@example.test', display_name: 'Synthetic user', facility_id: facility, facility_code: 'HMS', active_profile: 'hospital', session_version: 1, permission_version: 1,
      permissions: ['patient.demographics.view'], features: ['patients'], patient_visibility: ['demographics'], password_change_required: false,
      auth_security: { privileged_user: false, passkey_required: false, passkey_enrolled: Boolean(method), privileged_actions_allowed: true, recovery_codes_remaining: 0, factor_version: 1, assurance_version: 1, session_assurance: { method, verified_at: method ? new Date(now).toISOString() : null, expires_at: method ? new Date(now + 900000).toISOString() : null, credential_id: method === 'passkey' ? keyId : null } }, ...changes } };
  value.refresh_expires_at = value.session_absolute_expires_at; value.ordinary_confirmation = null; value.access_token = jwtFor(value, {}, now);
  value.user.auth_security.auth_clock = fixtureClock(now, value.access_token); return value;
}
export const pending = (status = 'factor_required') => { const now = Date.now(); return { status, login_grant: 'synthetic-restricted-login-grant', expires_at: new Date(now + 300000).toISOString(), auth_clock: { ...fixtureClock(now), access_token_remaining_ms: null }, methods: { passkey: true, recovery_code: true }, reason: status === 'setup_required' ? 'operator_bootstrap_required' : null }; };
export const options = () => ({ challenge_id: challengeId, challenge: 'AQID', rpId: 'localhost', allowCredentials: [] });
export const credential = () => ({ id: 'synthetic-browser-credential', type: 'public-key', rawId: new Uint8Array([1, 2]).buffer, response: { clientDataJSON: new Uint8Array([1]).buffer, authenticatorData: new Uint8Array([2]).buffer, signature: new Uint8Array([3]).buffer } });
export const json = (data, status = 200) => new Response(JSON.stringify({ data }), { status, headers: { 'content-type': 'application/json' } });
export const failure = (code, status = 403) => new Response(JSON.stringify({ error: { code, message: 'Synthetic operation denied.' } }), { status, headers: { 'content-type': 'application/json' } });

export function jwtFor(raw, overrides = {}, sampledAt = Date.now()) { const user = raw.user; const second = Math.floor(sampledAt / 1000); const claims = { sub: user.id, session_id: '99999999-0000-4000-8000-000000000020', facility_id: user.facility_id, active_profile: user.active_profile, session_version: user.session_version, permission_version: user.permission_version, auth_time: second - 5, iat: second, exp: second + 600, ...overrides }; latestToken = `synthetic.${btoa(JSON.stringify(claims)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}.synthetic`; return latestToken; }
export const networkDecision = (bearer = latestToken) => { const now = Date.now(); return { auth_clock: fixtureClock(now, bearer), classification: 'onsite', provenance: 'direct', policy_version: 1, mode: 'readonly', access_allowed: true, read_only: false, reauth_required: false, reauth_expires_at: null, evaluated_at: new Date(now).toISOString(), reason: 'onsite' }; };

// Complete actual clock/witness fixture producers. Malformed envelope tests use
// explicit raw payloads; json() never adds or repairs authority evidence.
export function fixtureClock(now, bearer = latestToken) {
  let expiry = now;
  try { expiry = JSON.parse(atob(bearer.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp * 1000; } catch { /* An explicit invalid bearer remains invalid in the real adapter. */ }
  return { database_observed_at: new Date(now).toISOString(), issuer_observed_at: new Date(now).toISOString(), access_token_remaining_ms: Math.max(0, Math.floor(expiry - now)) };
}
export function ordinaryToken(value, admitted = value.user.auth_security.auth_clock.database_observed_at) {
  const claims = JSON.parse(atob(value.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  value.ordinary_confirmation = { purpose: 'ordinary_password_confirmation', session_id: claims.session_id, assurance_version: value.user.auth_security.assurance_version, admitted_at: admitted, published_password_verified_at: admitted };
  return value;
}
