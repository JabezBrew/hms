import { activeTokenClock, assertServerClockSource, bindServerClock, clockDenialEpoch, clockNow, projectAuthSecurity, serverClock, serverClockSource } from '@/shared/lib/serverClock';

const NS_PER_MS = 1000000n;
const NS_PER_SECOND = 1000000000n;
const FIFTEEN_MINUTES = 900000n * NS_PER_MS;
const fail = () => { const error = new Error('The current server session proof could not be confirmed. Refresh or restart sign-in.'); error.code = 'auth_proof_invalid'; throw error; };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const safe = value => Number.isSafeInteger(value) && value >= 0;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

// Canonical UTC instants preserve all serialized fractions; Date.parse alone
// would make a future submillisecond proof appear equal to its observation.
export function clockInstant(value) {
  if (typeof value !== 'string') return fail();
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z$/.exec(value);
  if (!match) return fail();
  const seconds = Date.parse(`${match[1]}Z`);
  if (!Number.isSafeInteger(seconds) || seconds < 0 || new Date(seconds).toISOString().slice(0, 19) !== match[1]) return fail();
  return BigInt(seconds) * NS_PER_MS + BigInt((match[2] || '').padEnd(9, '0') || '0');
}
const elapsedNs = source => BigInt(Math.floor(assertServerClockSource(source) * Number(NS_PER_MS)));
const remainingMs = value => value <= 0n ? 0 : Number(value / NS_PER_MS);
export function tokenClaims(token) {
  try {
    const segments = token.split('.'); if (segments.length !== 3 || !segments[1]) return fail();
    const encoded = segments[1].replace(/-/g, '+').replace(/_/g, '/');
    const value = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')));
    if (!object(value) || ![value.iat, value.exp, value.auth_time].every(safe) || value.exp <= value.iat || value.auth_time > value.iat || !uuid(value.session_id) || !uuid(value.sub) || !uuid(value.facility_id) || !safe(value.session_version) || !safe(value.permission_version) || typeof value.active_profile !== 'string' || !value.active_profile) return fail();
    return value;
  } catch { return fail(); }
}
function factor(value, database) {
  if (!exact(value, ['method', 'verified_at', 'expires_at', 'credential_id'])) return fail();
  if (value.method === null) { if (!Object.values(value).every(item => item === null)) return fail(); return null; }
  if (!['passkey', 'recovery'].includes(value.method) || (value.method === 'recovery' ? value.credential_id !== null : !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.credential_id))) return fail();
  const start = clockInstant(value.verified_at); const end = clockInstant(value.expires_at);
  if (start > database || end <= start || end - start > FIFTEEN_MINUTES) return fail();
  return { start, end };
}
function observation(value, raw, { issuedToken = null } = {}) {
  const source = serverClockSource(value);
  assertServerClockSource(source);
  if (!exact(raw, ['database_observed_at', 'issuer_observed_at', 'access_token_remaining_ms'])) return fail();
  const database = clockInstant(raw.database_observed_at); const issuer = clockInstant(raw.issuer_observed_at);
  let access = null;
  const bearer = issuedToken || source.token;
  if (bearer) {
    const claims = tokenClaims(bearer);
    const issuedAt = BigInt(claims.iat) * NS_PER_SECOND; const expiry = BigInt(claims.exp) * NS_PER_SECOND;
    if (issuer < issuedAt || issuer >= expiry || !safe(raw.access_token_remaining_ms) || BigInt(raw.access_token_remaining_ms) !== (expiry - issuer) / NS_PER_MS) return fail();
    access = BigInt(raw.access_token_remaining_ms) * NS_PER_MS;
  } else if (raw.access_token_remaining_ms !== null) return fail();
  let active = null;
  const age = () => {
    if (!active) return elapsedNs(source);
    if (active.current?.() !== true || (active.network && active.denial !== clockDenialEpoch())) return fail();
    const elapsed = clockNow() - source.started;
    if (!Number.isFinite(elapsed) || elapsed < 0) return fail();
    return BigInt(Math.floor(elapsed * Number(NS_PER_MS)));
  };
  const proof = {
    database, issuer, source, token: bearer || null,
    remaining(deadline) { try { return remainingMs(clockInstant(deadline) - database - age()); } catch { return 0; } },
    tokenRemaining() { try { return access === null ? 0 : remainingMs(access - age()); } catch { return 0; } },
    shorten(other) { if (other.token !== bearer) return fail(); const limit = BigInt(other.tokenRemaining()) * NS_PER_MS + age(); if (access !== null && limit < access) access = limit; },
    elapsed() { return age(); },
    assertResponse() { assertServerClockSource(source); },
    createdDuring(instant) { const point = clockInstant(instant); return point <= database && database - point <= elapsedNs(source); },
    activate(current, { network = false } = {}) { assertServerClockSource(source); active = { current, network, denial: clockDenialEpoch() }; },
  };
  bindServerClock(value, proof);
  activeTokenClock(proof.token)?.shorten(proof);
  return proof;
}
export function observeTokenResponse(value, { newFactor = null, ordinary = false } = {}) {
  const source = serverClockSource(value);
  const allowed = ordinary ? ['/api/v2/auth/reauthenticate'] : newFactor === 'recovery' ? ['/api/v2/auth/login/recovery'] : newFactor === 'passkey' ? ['/api/v2/auth/login/passkey/verify', '/api/v2/auth/assurance/verify'] : ['/api/v2/auth/login', '/api/v2/auth/refresh'];
  if (source?.method !== 'POST' || !allowed.includes(source.path)) return fail();
  const user = value?.user; const security = user?.auth_security;
  if (!object(user) || !object(security) || typeof value.access_token !== 'string' || value.token_type !== 'Bearer' || !safe(value.expires_in_seconds) || value.expires_in_seconds === 0
    || !uuid(user.id) || !uuid(user.facility_id) || !safe(user.session_version) || !safe(user.permission_version) || typeof user.password_change_required !== 'boolean'
    || !['permissions', 'features', 'patient_visibility'].every(key => Array.isArray(user[key]) && user[key].every(item => typeof item === 'string'))
    || !['privileged_user', 'passkey_required', 'passkey_enrolled', 'privileged_actions_allowed'].every(key => typeof security[key] === 'boolean')
    || !['factor_version', 'assurance_version', 'recovery_codes_remaining'].every(key => safe(security[key]))) return fail();
  const proof = observation(value, security.auth_clock, { issuedToken: value.access_token });
  const claims = tokenClaims(value.access_token);
  if (BigInt(claims.auth_time) * NS_PER_SECOND > proof.database || claims.exp - claims.iat !== value.expires_in_seconds) return fail();
  for (const [key, expected] of Object.entries({ sub: user.id, facility_id: user.facility_id, active_profile: user.active_profile, permission_version: user.permission_version, session_version: user.session_version })) if (claims[key] !== expected) return fail();
  if (clockInstant(value.refresh_expires_at) <= proof.database || proof.tokenRemaining() <= 0 || clockInstant(value.session_idle_expires_at) <= proof.database || clockInstant(value.session_absolute_expires_at) <= proof.database || proof.remaining(value.session_idle_expires_at) <= 0 || proof.remaining(value.session_absolute_expires_at) <= 0) return fail();
  if (source.path === '/api/v2/auth/assurance/verify' && tokenClaims(source.token).session_id !== claims.session_id) return fail();
  const currentFactor = factor(security.session_assurance, proof.database);
  if (newFactor && (!currentFactor || security.session_assurance.method !== newFactor || !proof.createdDuring(security.session_assurance.verified_at) || proof.remaining(security.session_assurance.expires_at) <= 0)) return fail();
  const witness = value.ordinary_confirmation;
  if (ordinary) {
    if (!exact(witness, ['purpose', 'session_id', 'assurance_version', 'admitted_at', 'published_password_verified_at']) || witness.purpose !== 'ordinary_password_confirmation' || witness.session_id !== claims.session_id || !safe(witness.assurance_version) || witness.assurance_version > security.assurance_version) return fail();
    const admitted = clockInstant(witness.admitted_at); const published = clockInstant(witness.published_password_verified_at);
    if (admitted > proof.database || published > proof.database || published < admitted) return fail();
  } else if (witness !== null) return fail();
  proof.sessionRemaining = () => Math.min(proof.tokenRemaining(), proof.remaining(value.session_idle_expires_at), proof.remaining(value.session_absolute_expires_at));
  proof.idleRemaining = () => proof.remaining(value.session_idle_expires_at);
  proof.absoluteRemaining = () => proof.remaining(value.session_absolute_expires_at);
  proof.refreshRemaining = () => proof.remaining(value.refresh_expires_at);
  bindServerClock(user, proof); bindServerClock(security, proof); bindServerClock(security.session_assurance, proof);
  proof.assertResponse();
  return value;
}
export function observePendingGrant(value) {
  const source = serverClockSource(value);
  if (source?.method !== 'POST' || !['/api/v2/auth/login', '/api/v2/auth/setup/start', '/api/v2/auth/login/setup/verify'].includes(source.path)) return fail();
  const proof = observation(value, value?.auth_clock);
  if (proof.remaining(value.expires_at) <= 0) return fail();
  return value;
}
export function observeAssurance(value) {
  const source = serverClockSource(value);
  if (source?.method !== 'GET' || source.path !== '/api/v2/auth/assurance') return fail();
  const proof = observation(value, value?.auth_clock);
  factor(value?.assurance, proof.database);
  if (clockInstant(value.password_verified_at) > proof.database || clockInstant(value.password_fresh_until) < clockInstant(value.password_verified_at)) return fail();
  bindServerClock(value.assurance, proof);
  activeTokenClock(proof.token)?.shorten(proof);
  return value;
}
export function observeNetworkDecision(value, rawSource = value) {
  const source = serverClockSource(rawSource);
  if (source?.method !== 'GET' || !['/api/v2/auth/network-access', '/api/v2/admin/network-policy'].includes(source.path)) return fail();
  if (value?.auth_clock === null) return null;
  // The caller transfers the actual envelope source to a nested current decision.
  const proof = observation(rawSource, value?.auth_clock);
  if (value.reauth_expires_at !== null) clockInstant(value.reauth_expires_at);
  bindServerClock(value, proof);
  return proof;
}
export const stripClockSecurity = projectAuthSecurity;
export function observeUserResponse(value) {
  const source = serverClockSource(value);
  if (!['GET', 'PATCH'].includes(source?.method) || source.path !== '/api/v2/auth/me') return fail();
  const proof = observation(value, value?.auth_security?.auth_clock);
  const claims = tokenClaims(source.token);
  for (const [key, expected] of Object.entries({ sub: value.id, facility_id: value.facility_id, active_profile: value.active_profile, permission_version: value.permission_version, session_version: value.session_version })) if (claims[key] !== expected) return fail();
  factor(value.auth_security.session_assurance, proof.database);
  bindServerClock(value.auth_security, proof); bindServerClock(value.auth_security.session_assurance, proof);
  activeTokenClock(proof.token)?.shorten(proof);
  return value;
}
export const currentFactorRemaining = value => serverClock(value)?.remaining(value?.expires_at) || 0;
