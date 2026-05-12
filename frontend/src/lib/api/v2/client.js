import { getClientDeviceLabel } from '@/lib/device-label';

import { apiErrorFromEnvelope } from './errors';
import { appendV2QueryParams, buildV2ApiUrl } from './runtime';
import { createGeneratedClient } from './generated/client';

let getAccessToken = () => null;
let setAccessToken = () => {};
let onRefreshFailure = async () => {};
let getFacilityCode = () => null;
let isRefreshing = false;
let refreshPromise = null;

export function configureV2ApiClient({
  getAccessToken: tokenGetter,
  setAccessToken: tokenSetter,
  onRefreshFailure: refreshFailureHandler,
  getFacilityCode: facilityGetter,
} = {}) {
  if (typeof tokenGetter === 'function') {
    getAccessToken = tokenGetter;
  }
  if (typeof tokenSetter === 'function') {
    setAccessToken = tokenSetter;
  }
  if (typeof refreshFailureHandler === 'function') {
    onRefreshFailure = refreshFailureHandler;
  }
  if (typeof facilityGetter === 'function') {
    getFacilityCode = facilityGetter;
  }
}

export function __resetV2ApiClientForTests() {
  getAccessToken = () => null;
  setAccessToken = () => {};
  onRefreshFailure = async () => {};
  getFacilityCode = () => null;
  isRefreshing = false;
  refreshPromise = null;
}

export function hasV2RefreshSessionHint() {
  return Boolean(readCookie('hms_v2_csrf'));
}

export async function performV2TokenRefresh() {
  if (isRefreshing && refreshPromise) {
    return refreshPromise;
  }

  isRefreshing = true;
  refreshPromise = (async () => {
    try {
      const response = await rawV2Request({
        method: 'POST',
        path: '/api/v2/auth/refresh',
        skipAuthRefresh: true,
        includeCsrf: true,
      });
      const accessToken = response?.data?.access_token;
      if (accessToken) {
        setAccessToken(accessToken);
      }
      return response?.data || null;
    } catch {
      await onRefreshFailure();
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

export const v2Api = createGeneratedClient(v2Request);

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

  const resolvedPath = replacePathParams(path, pathParams);
  const url = appendV2QueryParams(buildV2ApiUrl(resolvedPath), query);
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
  try {
    response = await fetch(url, {
      method,
      headers,
      credentials: 'include',
      signal,
      body: body === undefined || body instanceof FormData ? body : JSON.stringify(body),
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw error;
    }
    throw apiErrorFromEnvelope(0, { message: error?.message || 'Network error' });
  }

  const data = await parseResponseBody(response);
  if (response.ok) {
    return data;
  }

  if (response.status === 401 && retryWithRefresh && !skipAuthRefresh) {
    const refreshed = await performV2TokenRefresh();
    if (refreshed?.access_token) {
      return rawV2Request(requestConfig, false);
    }
  }

  throw apiErrorFromEnvelope(response.status, data);
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
