/**
 * Base API client for making requests to the backend
 */
import { toast } from 'sonner';
import { getClientDeviceLabel } from './device-label';
import { getApiBasePathname, getApiBaseUrl } from './runtime-config';
import { configureRumAuth, recordApiTiming } from './observability/rum';

const AUTH_ENDPOINTS = [
  '/auth/login/',
  '/auth/register/',
  '/auth/password-reset/',
  '/auth/password-reset/confirm/',
  '/auth/password-reset/validate-token/',
  '/auth/logout/',
  '/auth/mfa/'
];

// Token provider - will be set by the auth context
let getAccessToken = () => null;
let setAccessTokenFn = () => {};
let onRefreshFailure = async () => {};
let getFacilityCode = () => null;

// Flag to track if a token refresh is in progress (singleton across all callers)
let isRefreshing = false;
// Promise to track the current refresh operation
let refreshPromise = null;
// Track consecutive refresh attempts to prevent infinite loops
let consecutiveRefreshAttempts = 0;
const MAX_CONSECUTIVE_REFRESHES = 3;
// Track when the last successful refresh happened to handle race conditions
let lastRefreshTime = 0;
// Grace period (ms) - if refresh completed within this time, reuse token instead of refreshing again
const REFRESH_GRACE_PERIOD = 5000;

// Refresh access tokens slightly before they expire to avoid avoidable 401s during polling.
const ACCESS_TOKEN_REFRESH_SKEW_SECONDS = 60;

function base64UrlDecodeToString(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  const base64 = normalized + padding;

  const atobFn = globalThis?.atob;
  if (typeof atobFn === 'function') {
    return atobFn(base64);
  }
  // Vitest/Node fallback (should not be used in browsers).
  const buf = globalThis?.Buffer;
  if (buf && typeof buf.from === 'function') {
    return buf.from(base64, 'base64').toString('utf8');
  }
  throw new Error('No base64 decoder available');
}

function decodeJwtPayload(token) {
  if (!token || typeof token !== 'string') {
    return null;
  }
  const parts = token.split('.');
  if (parts.length < 2) {
    return null;
  }
  try {
    return JSON.parse(base64UrlDecodeToString(parts[1]));
  } catch {
    return null;
  }
}

function isJwtExpiringSoon(token, skewSeconds = ACCESS_TOKEN_REFRESH_SKEW_SECONDS) {
  const payload = decodeJwtPayload(token);
  const exp = payload?.exp;
  if (typeof exp !== 'number') {
    return false;
  }
  const now = Math.floor(Date.now() / 1000);
  return exp <= now + skewSeconds;
}

// Function to set the token provider from the auth context
export function setAuthTokenProvider(tokenGetter, tokenSetter, refreshFailureHandler) {
  getAccessToken = tokenGetter;
  setAccessTokenFn = tokenSetter;
  onRefreshFailure = refreshFailureHandler;
  configureRumAuth({ getAccessToken, getFacilityCode });
}

export function setFacilityCodeProvider(facilityGetter) {
  getFacilityCode = facilityGetter;
  configureRumAuth({ getAccessToken, getFacilityCode });
}

/**
 * Centralized token refresh function - ensures only one refresh request at a time.
 * This is the ONLY place refresh requests should originate from.
 * @returns {Promise<string|null>} The new access token or null if refresh failed
 */
export async function performTokenRefresh() {
  // If a refresh is already in progress, wait for it
  if (isRefreshing && refreshPromise) {
    return refreshPromise;
  }

  // If a refresh completed very recently, use the current token
  // This handles race conditions where requests sent with old tokens get 401
  // after a refresh has already completed
  if (Date.now() - lastRefreshTime < REFRESH_GRACE_PERIOD) {
    const currentToken = getAccessToken();
    if (currentToken) {
      return currentToken;
    }
  }

  // Check consecutive attempts to prevent infinite loops
  if (consecutiveRefreshAttempts >= MAX_CONSECUTIVE_REFRESHES) {
    consecutiveRefreshAttempts = 0;
    await onRefreshFailure();
    return null;
  }

  // Start a new refresh
  isRefreshing = true;
  consecutiveRefreshAttempts++;

  refreshPromise = (async () => {
    try {
      const refreshHeaders = { 'Content-Type': 'application/json' };
      const facilityCode = getFacilityCode();
      if (facilityCode) {
        refreshHeaders['X-Facility-Code'] = facilityCode;
      }
      const deviceLabel = getClientDeviceLabel();
      if (deviceLabel) {
        refreshHeaders['X-Device-Label'] = deviceLabel;
      }

      const response = await fetch(`${getApiBaseUrl()}/auth/token/refresh/`, {
        method: 'POST',
        headers: refreshHeaders,
        credentials: 'include', // Include cookies for refresh token
      });

      if (!response.ok) {
        throw new Error('Token refresh failed');
      }

      const data = await response.json();

      // Update the access token in memory
      setAccessTokenFn(data.access);

      // Reset consecutive attempts on success and record refresh time
      consecutiveRefreshAttempts = 0;
      lastRefreshTime = Date.now();

      return data.access;
    } catch {
      // Reset attempts and notify auth context of failure
      consecutiveRefreshAttempts = 0;
      await onRefreshFailure();
      return null;
    } finally {
      isRefreshing = false;
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

/**
 * Handles API errors and formats them consistently
 */
class ApiError extends Error {
  constructor(message, status, data = null) {
    super(message);
    this.status = status;
    this.data = data;
    this.name = 'ApiError';
  }
}

/**
 * Gets the CSRF token from cookies
 */
function getCsrfToken() {
  const cookies = document.cookie.split(';');
  for (let cookie of cookies) {
    const [name, value] = cookie.trim().split('=');
    if (name === 'csrftoken') {
      return value;
    }
  }
  return null;
}

/**
 * Makes a request to the API with proper error handling and token refresh
 */
async function fetchWithAuth(endpoint, options = {}, retryWithRefresh = true) {
  const url = `${getApiBaseUrl()}${endpoint}`;
  const startedAt = globalThis?.performance?.now?.() ?? Date.now();
  let observedStatus = null;

  // Skip token refresh for auth endpoints.
  // Note: `/auth/token/refresh/` is intentionally excluded from AUTH_ENDPOINTS.
  const isAuthEndpoint = AUTH_ENDPOINTS.some(authPath => endpoint.includes(authPath));

  // Get auth token from memory. This is in-memory only, so it can be null after reload.
  let token = getAccessToken();

  const { parseAs, ...fetchOptions } = options;

  // Proactively refresh near-expiry tokens to avoid a guaranteed 401, especially on polled endpoints.
  // If refresh fails (network, etc), fall back to the current token and let normal 401 handling apply.
  if (token && !isAuthEndpoint && endpoint !== '/auth/token/refresh/' && isJwtExpiringSoon(token)) {
    const refreshed = await performTokenRefresh();
    if (refreshed) {
      token = refreshed;
    }
  }

  // Set default headers
  const headers = { ...(fetchOptions.headers || {}) };

  // Only set JSON content-type when we are not sending multipart/form-data.
  // When using FormData, the browser will set the appropriate boundary.
  const isFormData = typeof FormData !== 'undefined' && fetchOptions.body instanceof FormData;
  if (!headers['Content-Type'] && !isFormData) {
    headers['Content-Type'] = 'application/json';
  }

  // Add auth token if available
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const facilityCode = getFacilityCode();
  if (facilityCode && !headers['X-Facility-Code']) {
    headers['X-Facility-Code'] = facilityCode;
  }

  // If we are about to make a write request and don't have an access token yet,
  // refresh it first so we authenticate via JWT (not session cookies + CSRF).
  const method = (options.method || 'GET').toUpperCase();
  const isWriteMethod = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
  if (!token && isWriteMethod && !isAuthEndpoint && endpoint !== '/auth/token/refresh/') {
    token = await performTokenRefresh();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    } else {
      throw new ApiError('Authentication required', 401);
    }
  }

  // Add CSRF token for non-GET requests
  if (options.method && options.method !== 'GET') {
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      headers['X-CSRFToken'] = csrfToken;
    }
  }

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      headers,
      credentials: 'include', // Include cookies for refresh token
    });
    observedStatus = response.status;

    // Parse response data
    let data;
    const contentType = response.headers.get('content-type');
    if (response.ok && parseAs === 'blob') {
      data = await response.blob();
    } else if (response.ok && parseAs === 'arrayBuffer') {
      data = await response.arrayBuffer();
    } else if (parseAs === 'text') {
      data = await response.text();
    } else if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    // Handle error responses
    if (!response.ok) {
      // Try to extract error message from various formats
      let message = 'An error occurred';

      if (data?.detail) {
        message = data.detail;
      } else if (data?.message) {
        message = data.message;
      } else if (typeof data === 'object' && data !== null) {
        // Django REST Framework field errors
        const fieldErrors = Object.entries(data)
          .filter(([key]) => !['status', 'code'].includes(key))
          .map(([field, errors]) => {
            const errorArray = Array.isArray(errors) ? errors : [errors];
            return `${field}: ${errorArray.join(', ')}`;
          });

        if (fieldErrors.length > 0) {
          message = fieldErrors.join('; ');
        }
      } else if (typeof data === 'string') {
        message = data;
      }

      // Handle rate limiting (429 Too Many Requests)
      if (response.status === 429) {
        const retryAfter = data?.retry_after || 60;
        const waitTime = retryAfter >= 60
          ? `${Math.ceil(retryAfter / 60)} minute${Math.ceil(retryAfter / 60) > 1 ? 's' : ''}`
          : `${retryAfter} second${retryAfter > 1 ? 's' : ''}`;

        toast.error(`Too many requests. Please wait ${waitTime} before trying again.`, {
          duration: 5000,
          description: 'Rate limit exceeded',
        });

        throw new ApiError(message, response.status, data);
      }

      // Skip token refresh for auth endpoints
      // If unauthorized and we haven't retried yet, try to refresh the token
      if (response.status === 401 && retryWithRefresh && !isAuthEndpoint) {
        // Don't attempt to refresh for the refresh endpoint itself
        if (endpoint === '/auth/token/refresh/') {
          throw new ApiError(message, response.status, data);
        }

        try {
          // Use centralized refresh - handles deduplication internally
          const newToken = await performTokenRefresh();

          if (newToken) {
            // Retry the original request with the new token
            return await fetchWithAuth(endpoint, options, false);
          } else {
            // Refresh failed, throw error
            throw new ApiError(message, response.status, data);
          }
        } catch {
          // If refresh fails, throw the original error
          throw new ApiError(message, response.status, data);
        }
      }

      throw new ApiError(message, response.status, data);
    }

    // Successful request, reset refresh counter
    consecutiveRefreshAttempts = 0;
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw error;
    }

    // Re-throw ApiError instances
    if (error instanceof ApiError) {
      throw error;
    }

    // Handle network errors
    throw new ApiError(
      error.message || 'Network error',
      0,
      { originalError: error }
    );
  } finally {
    const endedAt = globalThis?.performance?.now?.() ?? Date.now();
    recordApiTiming({
      endpoint,
      method: options.method || 'GET',
      durationMs: endedAt - startedAt,
      status: observedStatus,
    });
  }
}

/**
 * Helper function to handle paginated responses
 * If the response has a 'results' property, it returns the results array
 * Otherwise, it returns the original response
 */
function handlePaginatedResponse(response) {
  // Check if the response is paginated (has a 'results' property)
  if (response && typeof response === 'object' && Array.isArray(response.results)) {
    return response.results;
  }
  return response;
}

/**
 * Fetches all pages of a paginated response and combines the results
 * @param {string} endpoint - The API endpoint to fetch
 * @param {Object} options - Fetch options
 * @returns {Promise<Array>} - Combined results from all pages
 */
async function fetchAllPages(endpoint, options = {}) {
  let allResults = [];
  let nextUrl = endpoint;
  const { signal } = options;

  while (nextUrl) {
    if (signal?.aborted) {
      throw signal.reason || new DOMException('The operation was aborted.', 'AbortError');
    }

    // Extract the path from the full URL if it's an absolute URL
    let path = nextUrl;
    if (nextUrl.startsWith('http')) {
      const url = new URL(nextUrl);
      path = url.pathname + url.search;
      // Remove the configured API pathname prefix if present since fetchWithAuth will add it back.
      const apiBasePathname = getApiBasePathname();
      if (apiBasePathname && path.startsWith(apiBasePathname)) {
        path = path.substring(apiBasePathname.length) || '/';
      }
    }

    // Fetch the current page
    const response = await fetchWithAuth(path, { ...options, method: 'GET' });

    // Add results from this page
    if (response && typeof response === 'object' && Array.isArray(response.results)) {
      allResults.push(...response.results);

      // Get the next page URL, if any
      nextUrl = response.next;
    } else {
      // Not a paginated response, just return it
      return response;
    }
  }

  return allResults;
}

/**
 * API client with methods for different request types
 */
function appendQueryParams(endpoint, params) {
  if (!params || typeof params !== 'object') {
    return endpoint;
  }
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item !== undefined && item !== null && item !== '') {
          searchParams.append(key, String(item));
        }
      });
      return;
    }
    searchParams.append(key, String(value));
  });
  const queryString = searchParams.toString();
  if (!queryString) {
    return endpoint;
  }
  const separator = endpoint.includes('?') ? '&' : '?';
  return `${endpoint}${separator}${queryString}`;
}

export const apiClient = {
  get: async (endpoint, options = {}) => {
    const { params, ...rest } = options;
    const url = appendQueryParams(endpoint, params);
    const response = await fetchWithAuth(url, { ...rest, method: 'GET' });
    return handlePaginatedResponse(response);
  },

  /**
   * Get all pages of a paginated response
   * Use this when you need all results from a paginated endpoint
   */
  getAll: (endpoint, options = {}) => {
    const { params, ...rest } = options;
    const url = appendQueryParams(endpoint, params);
    return fetchAllPages(url, rest);
  },

  post: (endpoint, data, options = {}) => 
    fetchWithAuth(endpoint, { 
      ...options, 
      method: 'POST',
      body: JSON.stringify(data),
    }),

  postForm: (endpoint, formData, options = {}) =>
    fetchWithAuth(endpoint, {
      ...options,
      method: 'POST',
      body: formData,
    }),

  put: (endpoint, data, options = {}) => 
    fetchWithAuth(endpoint, { 
      ...options, 
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  patch: (endpoint, data, options = {}) => 
    fetchWithAuth(endpoint, { 
      ...options, 
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  delete: (endpoint, options = {}) => 
    fetchWithAuth(endpoint, { ...options, method: 'DELETE' }),

  /**
   * Get the full response including pagination metadata
   * Use this when you need access to pagination info (count, next, previous)
   */
  getWithPagination: (endpoint, options = {}) => {
    const { params, ...rest } = options;
    const url = appendQueryParams(endpoint, params);
    return fetchWithAuth(url, { ...rest, method: 'GET' });
  },

  getBlob: (endpoint, options = {}) => {
    const { params, ...rest } = options;
    const url = appendQueryParams(endpoint, params);
    return fetchWithAuth(url, { ...rest, method: 'GET', parseAs: 'blob' });
  },
};

/**
 * Error handler for API requests
 */
export function handleApiError(error, defaultMessage = 'An error occurred') {
  // Log errors in development only
  if (import.meta.env.DEV) {
    console.error('API Error:', error);
  }

  if (error instanceof ApiError) {
    // For most errors, just return the error message
    return error.message || defaultMessage;
  }

  return defaultMessage;
}
