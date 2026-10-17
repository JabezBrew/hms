import { getClientDeviceLabel } from '@/lib/device-label';
import { hashQueryValue } from '@/shared/lib/privateQueryKey';
import { publishFactorRequirement } from '@/shared/lib/factorRequiredSignal';

import { apiErrorFromEnvelope } from './errors';
import { appendV2QueryParams, buildV2ApiUrl } from './runtime';
import { assertNetworkRequestAllowed, currentNetworkAuthorityScope, currentNetworkPrincipal, isNetworkWorkflowWrite, resetNetworkAccessGuardForTests, waitForNetworkRequestAccess } from './networkAccessGuard';
import { assertWriteAttemptDispatchAllowed, attachWriteResponseMetadata, beginWriteAttempt, captureWriteRecoveryRead, confirmWriteAttempt, markWriteAttemptUncertain, recordWriteRecoveryRead, rejectWriteAttempt, resetWriteUncertaintyForTests } from './writeUncertainty';

let getAccessToken = () => null;
let setAccessToken = () => {};
let onRefreshFailure = async () => {};
let getFacilityCode = () => null;
let canRefreshSession = () => true;
let isRefreshing = false;
let refreshPromise = null;
const scopeSubscribers = new Set();
const FACTOR_REQUIRED_CODES = new Set(['passkey_verification_required', 'password_confirmation_required', 'reauth_required']);
export function subscribeV2ClientScope(subscriber) { scopeSubscribers.add(subscriber); return () => scopeSubscribers.delete(subscriber); }
const publishScopeChange = () => scopeSubscribers.forEach((subscriber) => subscriber());

function hashScopeValue(value) {
  let hash = 0;
  const input = String(value || '');
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) - hash) + input.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

export function configureV2ApiClient({
  getAccessToken: tokenGetter,
  setAccessToken: tokenSetter,
  onRefreshFailure: refreshFailureHandler,
  getFacilityCode: facilityGetter,
  canRefreshSession: canRefreshSessionChecker,
} = {}) {
  if (typeof tokenGetter === 'function') {
    getAccessToken = tokenGetter;
  }
  if (typeof tokenSetter === 'function') {
    setAccessToken = (token) => { tokenSetter(token); publishScopeChange(); };
  }
  if (typeof refreshFailureHandler === 'function') {
    onRefreshFailure = refreshFailureHandler;
  }
  if (typeof facilityGetter === 'function') {
    getFacilityCode = facilityGetter;
  }
  if (typeof canRefreshSessionChecker === 'function') {
    canRefreshSession = canRefreshSessionChecker;
  }
  publishScopeChange();
}

export function __resetV2ApiClientForTests() {
  resetNetworkAccessGuardForTests();
  resetWriteUncertaintyForTests();
  getAccessToken = () => null;
  setAccessToken = () => {};
  onRefreshFailure = async () => {};
  getFacilityCode = () => null;
  canRefreshSession = () => true;
  isRefreshing = false;
  refreshPromise = null;
  scopeSubscribers.clear();
}

export function hasV2RefreshSessionHint() {
  return Boolean(readCookie('hms_v2_csrf'));
}

export function getV2ClientScopeForToken(token, facility) {
  return [
    `facility:${hashScopeValue(facility)}`,
    `token:${hashScopeValue(token)}`,
  ].join(':');
}

export function getV2ClientScopeKey() {
  return getV2ClientScopeForToken(getAccessToken(), getFacilityCode());
}

export async function performV2TokenRefresh({ notifyFailure = true } = {}) {
  if (!canRefreshSession()) {
    if (notifyFailure) {
      await onRefreshFailure();
    }
    return null;
  }

  if (isRefreshing && refreshPromise) {
    return refreshPromise;
  }

  isRefreshing = true;
  const refreshAuthority = currentNetworkAuthorityScope();
  const refreshPrincipal = currentNetworkPrincipal();
  const refreshScope = getV2ClientScopeKey();
  refreshPromise = (async () => {
    try {
      const response = await rawV2Request({
        method: 'POST',
        path: '/api/v2/auth/refresh',
        skipAuthRefresh: true,
        includeCsrf: true,
      });
      // A refresh started for an earlier account/profile must never overwrite
      // credentials selected while its response was in flight.
      if (currentNetworkAuthorityScope() !== refreshAuthority || getV2ClientScopeKey() !== refreshScope) return null;
      if (refreshPrincipal && Object.entries(refreshPrincipal).some(([field, value]) => value !== undefined && value !== null && response?.data?.user?.[field] !== value)) {
        if (notifyFailure) await onRefreshFailure();
        return null;
      }
      const accessToken = response?.data?.access_token;
      if (accessToken) {
        setAccessToken(accessToken);
      }
      return response?.data || null;
    } catch {
      if (notifyFailure && currentNetworkAuthorityScope() === refreshAuthority && getV2ClientScopeKey() === refreshScope) {
        await onRefreshFailure();
      }
      return null;
    } finally {
      isRefreshing = false;
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export async function v2Request(requestConfig) {
  return rawV2Request(requestConfig, true);
}

async function rawV2Request(requestConfig, retryWithRefresh = true) {
  const {
    method = 'GET',
    path,
    pathParams,
    query,
    body,
    signal,
    headers: requestHeaders,
    skipAuthRefresh = false,
    includeCsrf = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS',
  } = requestConfig;

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const originAuthority = currentNetworkAuthorityScope();
  const originTransport = getV2ClientScopeKey();
  const requestPrincipal = currentNetworkPrincipal();
  const originPrincipal = requestPrincipal ? { ...requestPrincipal } : null;
  assertNetworkRequestAllowed({ method, path, transportScope: originTransport });

  const resolvedPath = replacePathParams(path, pathParams);
  const url = appendV2QueryParams(buildV2ApiUrl(resolvedPath), query);
  let serializedBody = body === undefined || body instanceof FormData ? body : JSON.stringify(body);
  if (body instanceof FormData) { serializedBody = new FormData(); body.forEach((value, key) => serializedBody.append(key, value)); }
  const bodySnapshot = typeof serializedBody === 'string' ? JSON.parse(serializedBody) : serializedBody;
  const querySnapshot = {};
  new URL(url, globalThis.location?.href || 'http://localhost').searchParams.forEach((value, key) => { querySnapshot[key] = key in querySnapshot ? [...(Array.isArray(querySnapshot[key]) ? querySnapshot[key] : [querySnapshot[key]]), value] : value; });
  const pathSnapshot = pathParams ? Object.fromEntries(Object.entries(pathParams).map(([key, value]) => [key, String(value)])) : undefined;
  const retryConfig = { ...requestConfig, body: bodySnapshot, query: querySnapshot, pathParams: pathSnapshot };
  const tracked = isNetworkWorkflowWrite(method, path);
  const attempt = tracked && originPrincipal?.id ? await beginWriteAttempt({ method, path, resolvedPath, pathParams: pathSnapshot, query: querySnapshot, body: bodySnapshot, unsupportedBody: body instanceof FormData }, { principal: originPrincipal, authority: originAuthority, transport: originTransport }) : null;
  const readEvidence = !tracked && originPrincipal?.id ? captureWriteRecoveryRead() : [];
  try {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    if (currentNetworkAuthorityScope() !== originAuthority || getV2ClientScopeKey() !== originTransport) throw apiErrorFromEnvelope(403, { error: { code: 'request_scope_changed', message: 'The request context changed. Review this workflow before submitting it again.' } });
    assertNetworkRequestAllowed({ method, path, transportScope: originTransport });
  } catch (error) { rejectWriteAttempt(attempt); throw error; }
  const headers = { ...(requestHeaders || {}) };

  if (body !== undefined && !(body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const token = getAccessToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const facilityCode = getFacilityCode();
  if (facilityCode && !headers['X-Facility-Code']) {
    headers['X-Facility-Code'] = facilityCode;
  }

  const deviceLabel = getClientDeviceLabel();
  if (deviceLabel && !headers['X-Device-Label']) {
    headers['X-Device-Label'] = deviceLabel;
  }

  if (includeCsrf) {
    const csrfToken = readCookie('hms_v2_csrf');
    if (csrfToken) {
      headers['X-HMS-CSRF'] = csrfToken;
    }
  }

  let response;
  try { assertWriteAttemptDispatchAllowed(attempt); } catch (error) { rejectWriteAttempt(attempt); throw error; }
  try {
    response = await fetch(url, {
      method,
      headers,
      credentials: 'include',
      signal,
      body: serializedBody,
    });
  } catch (error) {
    markWriteAttemptUncertain(attempt);
    const failure = error?.name === 'AbortError' ? error : apiErrorFromEnvelope(0, { message: error?.message || 'Network error' });
    attachWriteResponseMetadata(failure, attempt);
    throw failure;
  }

  let data;
  try { data = await parseResponseBody(response); } catch (error) { markWriteAttemptUncertain(attempt); attachWriteResponseMetadata(error, attempt); throw error; }
  if (response.ok) {
    if (attempt && (!data || typeof data !== 'object' || !('data' in data))) {
      markWriteAttemptUncertain(attempt);
      const failure = apiErrorFromEnvelope(0, { error: { code: 'write_response_unconfirmed', message: 'The change may already be saved, but its response could not be confirmed. Review the affected workflow before making another change.' } });
      attachWriteResponseMetadata(failure, attempt);
      throw failure;
    }
    confirmWriteAttempt(attempt, data);
    if (!tracked) { try { await recordWriteRecoveryRead({ resolvedPath, pathParams: pathSnapshot, query: querySnapshot, body: bodySnapshot }, data, { principal: originPrincipal, readEvidence }); } catch { /* Recovery storage failures must not prevent authorized reads. */ } }
    return data;
  }

  if (response.status >= 500 || String(data?.error?.code || '').endsWith('_unconfirmed')) markWriteAttemptUncertain(attempt);
  else rejectWriteAttempt(attempt);

  if (
    response.status === 401
    && retryWithRefresh
    && !skipAuthRefresh
    && resolvedPath !== '/api/v2/auth/logout'
  ) {
    const assertOrigin = () => { if (currentNetworkAuthorityScope() !== originAuthority) throw apiErrorFromEnvelope(403, { error: { code: 'request_scope_changed', message: 'The signed-in account or access scope changed. Review this workflow before submitting it again.' } }); };
    assertOrigin();
    // Another same-scope request may already have rotated an expired token.
    // Reuse that proof only when the original authority is still bound.
    if (getV2ClientScopeKey() !== originTransport) {
      if (!originAuthority) throw apiErrorFromEnvelope(403, { error: { code: 'request_scope_changed', message: 'The request context changed. Review this workflow before submitting it again.' } });
      await waitForNetworkRequestAccess({ method, path, transportScope: getV2ClientScopeKey(), authorityScope: originAuthority, signal });
      assertOrigin();
      return rawV2Request(retryConfig, false);
    }
    const refreshed = await performV2TokenRefresh();
    assertOrigin();
    if (refreshed?.access_token) {
      await waitForNetworkRequestAccess({ method, path, transportScope: getV2ClientScopeKey(), authorityScope: originAuthority, signal });
      assertOrigin();
      return rawV2Request(retryConfig, false);
    }
  }

  // A late response from another account or authority cannot prompt the current
  // user. The UI receives only its existing opaque authorization-scope hash.
  if (response.status === 403 && FACTOR_REQUIRED_CODES.has(data?.error?.code)
    && !signal?.aborted && originPrincipal?.id && originAuthority
    && currentNetworkAuthorityScope() === originAuthority && getV2ClientScopeKey() === originTransport
    && ['id', 'facility_id', 'active_profile'].every((key) => currentNetworkPrincipal()?.[key] === originPrincipal[key])) {
    publishFactorRequirement(hashQueryValue(JSON.stringify([originTransport, originAuthority])));
  }
  const failure = apiErrorFromEnvelope(response.status, data); attachWriteResponseMetadata(failure, attempt); throw failure;
}

async function parseResponseBody(response) {
  if (response.status === 204) {
    return null;
  }
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  return response.text();
}

function replacePathParams(path, pathParams = {}) {
  return String(path || '').replace(/\{([^}]+)\}/g, (_, name) => {
    const value = pathParams?.[name];
    if (value === undefined || value === null || value === '') {
      throw new Error(`Missing V2 API path parameter: ${name}`);
    }
    return encodeURIComponent(String(value));
  });
}

function readCookie(name) {
  const cookieString = globalThis?.document?.cookie || '';
  return cookieString.split(';').find((cookie) => {
    const [cookieName] = cookie.trim().split('=');
    return cookieName === name;
  })?.trim().split('=').slice(1).join('=') || null;
}
