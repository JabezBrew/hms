import { jwtFor, token } from './fixtures';
export const issuerNow = Date.parse('2026-10-18T10:00:00Z');
export const databaseNow = issuerNow + 60000;
export const sessionId = '99999999-0000-4000-8000-000000000020';
export function clockToken({ ordinary = false, session = sessionId, revision = ordinary ? 1 : 0, authTime = ordinary ? issuerNow / 1000 : issuerNow / 1000 - 120, method = null, proofTime = databaseNow } = {}) {
  const value = token(method);
  value.user.auth_security.assurance_version = revision;
  if (method) { value.user.auth_security.session_assurance.verified_at = new Date(proofTime).toISOString(); value.user.auth_security.session_assurance.expires_at = new Date(proofTime + 900000).toISOString(); }
  value.user.auth_security.auth_clock = clockObservation();
  value.access_token = jwtFor(value, { iat: issuerNow / 1000, auth_time: authTime, exp: issuerNow / 1000 + 600, session_id: session });
  value.refresh_expires_at = new Date(databaseNow + 28800000).toISOString();
  value.session_idle_expires_at = new Date(databaseNow + 1800000).toISOString();
  value.session_absolute_expires_at = value.refresh_expires_at;
  value.ordinary_confirmation = ordinary ? { purpose: 'ordinary_password_confirmation', session_id: session, assurance_version: revision, admitted_at: new Date(databaseNow).toISOString(), published_password_verified_at: new Date(databaseNow).toISOString() } : null;
  return value;
}
export function clockObservation() { return { database_observed_at: new Date(databaseNow).toISOString(), issuer_observed_at: new Date(issuerNow).toISOString(), access_token_remaining_ms: 600000 }; }
export function clockNetwork() { return { classification: 'onsite', provenance: 'direct', policy_version: 1, mode: 'readonly', access_allowed: true, read_only: false, reauth_required: false, reauth_expires_at: null, evaluated_at: new Date(databaseNow).toISOString(), reason: 'onsite', auth_clock: clockObservation() }; }
