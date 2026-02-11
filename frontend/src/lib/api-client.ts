/**
 * Base API client for making requests to the backend
 */
import { toast } from 'sonner'
import type {
  ApiClient,
  ApiErrorPayload,
  ApiRequestOptions,
  JwtPayload,
  PaginatedResponse,
  QueryParamValue,
} from '@/types/api'

// Base URL for API requests
// In production, use the backend URL. In development, use Vite's proxy.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.PROD ? 'https://backend-production-d15a.up.railway.app/api' : '/api')

const AUTH_ENDPOINTS = [
  '/auth/login/',
  '/auth/register/',
  '/auth/password-reset/',
  '/auth/password-reset/confirm/',
  '/auth/password-reset/validate-token/',
  '/auth/logout/',
  '/auth/mfa/'
] as const

type TokenGetter = () => string | null
type TokenSetter = (token: string | null) => void
type RefreshFailureHandler = () => Promise<void>
type FacilityCodeGetter = () => string | null

// Token provider - will be set by the auth context
let getAccessToken: TokenGetter = () => null
let setAccessTokenFn: TokenSetter = () => {}
let onRefreshFailure: RefreshFailureHandler = async () => {}
let getFacilityCode: FacilityCodeGetter = () => null

// Flag to track if a token refresh is in progress (singleton across all callers)
let isRefreshing = false
// Promise to track the current refresh operation
let refreshPromise: Promise<string | null> | null = null
// Track consecutive refresh attempts to prevent infinite loops
let consecutiveRefreshAttempts = 0
const MAX_CONSECUTIVE_REFRESHES = 3
// Track when the last successful refresh happened to handle race conditions
let lastRefreshTime = 0
// Grace period (ms) - if refresh completed within this time, reuse token instead of refreshing again
const REFRESH_GRACE_PERIOD = 5000

// Refresh access tokens slightly before they expire to avoid avoidable 401s during polling.
const ACCESS_TOKEN_REFRESH_SKEW_SECONDS = 60

function base64UrlDecodeToString(value: string): string {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/')
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4))
  const base64 = normalized + padding

  const atobFn = globalThis?.atob
  if (typeof atobFn === 'function') {
    return atobFn(base64)
  }
  // Vitest/Node fallback (should not be used in browsers).
  const buf = globalThis?.Buffer
  if (buf && typeof buf.from === 'function') {
    return buf.from(base64, 'base64').toString('utf8')
  }
  throw new Error('No base64 decoder available')
}

function decodeJwtPayload(token: string | null): JwtPayload | null {
  if (!token || typeof token !== 'string') {
    return null
  }
  const parts = token.split('.')
  if (parts.length < 2) {
    return null
  }
  try {
    return JSON.parse(base64UrlDecodeToString(parts[1])) as JwtPayload
  } catch {
    return null
  }
}

function isJwtExpiringSoon(token: string | null, skewSeconds = ACCESS_TOKEN_REFRESH_SKEW_SECONDS): boolean {
  const payload = decodeJwtPayload(token)
  const exp = payload?.exp
  if (typeof exp !== 'number') {
    return false
  }
  const now = Math.floor(Date.now() / 1000)
  return exp <= now + skewSeconds
}

// Function to set the token provider from the auth context
export function setAuthTokenProvider(
  tokenGetter: TokenGetter,
  tokenSetter: TokenSetter,
  refreshFailureHandler: RefreshFailureHandler,
): void {
  getAccessToken = tokenGetter
  setAccessTokenFn = tokenSetter
  onRefreshFailure = refreshFailureHandler
}

export function setFacilityCodeProvider(facilityGetter: FacilityCodeGetter): void {
  getFacilityCode = facilityGetter
}

/**
 * Centralized token refresh function - ensures only one refresh request at a time.
 * This is the ONLY place refresh requests should originate from.
 * @returns {Promise<string|null>} The new access token or null if refresh failed
 */
export async function performTokenRefresh() {
  // If a refresh is already in progress, wait for it
  if (isRefreshing && refreshPromise) {
    return refreshPromise
  }

  // If a refresh completed very recently, use the current token
  // This handles race conditions where requests sent with old tokens get 401
  // after a refresh has already completed
  if (Date.now() - lastRefreshTime < REFRESH_GRACE_PERIOD) {
    const currentToken = getAccessToken();
    if (currentToken) {
      return currentToken
    }
  }

  // Check consecutive attempts to prevent infinite loops
  if (consecutiveRefreshAttempts >= MAX_CONSECUTIVE_REFRESHES) {
    consecutiveRefreshAttempts = 0
    await onRefreshFailure()
    return null
  }

  // Start a new refresh
  isRefreshing = true
  consecutiveRefreshAttempts++

  refreshPromise = (async () => {
    try {
      const refreshHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
      const facilityCode = getFacilityCode()
      if (facilityCode) {
        refreshHeaders['X-Facility-Code'] = facilityCode
      }

      const response = await fetch(`${API_BASE_URL}/auth/token/refresh/`, {
        method: 'POST',
        headers: refreshHeaders,
        credentials: 'include', // Include cookies for refresh token
      })

      if (!response.ok) {
        throw new Error('Token refresh failed')
      }

      const data = (await response.json()) as { access?: string }

      // Update the access token in memory
      setAccessTokenFn(data.access ?? null)

      // Reset consecutive attempts on success and record refresh time
      consecutiveRefreshAttempts = 0
      lastRefreshTime = Date.now()

      return data.access ?? null
    } catch (_error) {
      // Reset attempts and notify auth context of failure
      consecutiveRefreshAttempts = 0
      await onRefreshFailure()
      return null
    } finally {
      isRefreshing = false
      refreshPromise = null
    }
  })()

  return refreshPromise
}

/**
 * Handles API errors and formats them consistently
 */
class ApiError extends Error {
  status: number
  data: unknown

  constructor(message: string, status: number, data: unknown = null) {
    super(message)
    this.status = status
    this.data = data
    this.name = 'ApiError'
  }
}

/**
 * Gets the CSRF token from cookies
 */
function getCsrfToken() {
  const cookies = document.cookie.split(';')
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
async function fetchWithAuth(
  endpoint: string,
  options: ApiRequestOptions = {},
  retryWithRefresh = true,
): Promise<unknown> {
  const url = `${API_BASE_URL}${endpoint}`

  // Skip token refresh for auth endpoints.
  // Note: `/auth/token/refresh/` is intentionally excluded from AUTH_ENDPOINTS.
  const isAuthEndpoint = AUTH_ENDPOINTS.some((authPath) => endpoint.includes(authPath))

  // Get auth token from memory. This is in-memory only, so it can be null after reload.
  let token = getAccessToken()

  const { parseAs, ...fetchOptions } = options

  // Proactively refresh near-expiry tokens to avoid a guaranteed 401, especially on polled endpoints.
  // If refresh fails (network, etc), fall back to the current token and let normal 401 handling apply.
  if (token && !isAuthEndpoint && endpoint !== '/auth/token/refresh/' && isJwtExpiringSoon(token)) {
    const refreshed = await performTokenRefresh();
    if (refreshed) {
      token = refreshed;
    }
  }

  // Set default headers
  const headers: Record<string, string> = { ...((fetchOptions.headers as Record<string, string>) || {}) }

  // Only set JSON content-type when we are not sending multipart/form-data.
  // When using FormData, the browser will set the appropriate boundary.
  const isFormData = typeof FormData !== 'undefined' && fetchOptions.body instanceof FormData
  if (!headers['Content-Type'] && !isFormData) {
    headers['Content-Type'] = 'application/json';
  }

  // Add auth token if available
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const facilityCode = getFacilityCode()
  if (facilityCode && !headers['X-Facility-Code']) {
    headers['X-Facility-Code'] = facilityCode;
  }

  // If we are about to make a write request and don't have an access token yet,
  // refresh it first so we authenticate via JWT (not session cookies + CSRF).
  const method = (options.method || 'GET').toUpperCase()
  const isWriteMethod = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS'
  if (!token && isWriteMethod && !isAuthEndpoint && endpoint !== '/auth/token/refresh/') {
    token = await performTokenRefresh();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    } else {
      throw new ApiError('Authentication required', 401)
    }
  }

  // Add CSRF token for non-GET requests
  if (options.method && options.method !== 'GET') {
    const csrfToken = getCsrfToken()
    if (csrfToken) {
      headers['X-CSRFToken'] = csrfToken
    }
  }

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      headers,
      credentials: 'include', // Include cookies for refresh token
    });

    // Parse response data
    let data: unknown
    const contentType = response.headers.get('content-type')
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
      let message = 'An error occurred'

      if (
        data &&
        typeof data === 'object' &&
        'detail' in data &&
        typeof (data as ApiErrorPayload).detail === 'string'
      ) {
        message = (data as ApiErrorPayload).detail as string
      } else if (
        data &&
        typeof data === 'object' &&
        'message' in data &&
        typeof (data as ApiErrorPayload).message === 'string'
      ) {
        message = (data as ApiErrorPayload).message as string
      } else if (typeof data === 'object' && data !== null) {
        // Django REST Framework field errors
        const fieldErrors = Object.entries(data as Record<string, unknown>)
          .filter(([key]) => !['status', 'code'].includes(key))
          .map(([field, errors]) => {
            const errorArray = Array.isArray(errors) ? errors : [errors]
            return `${field}: ${errorArray.map((value) => String(value)).join(', ')}`
          })

        if (fieldErrors.length > 0) {
          message = fieldErrors.join('; ')
        }
      } else if (typeof data === 'string') {
        message = data
      }

      // Handle rate limiting (429 Too Many Requests)
      if (response.status === 429) {
        const retryAfter =
          data && typeof data === 'object' && 'retry_after' in data
            ? Number((data as ApiErrorPayload).retry_after ?? 60)
            : 60
        const waitTime = retryAfter >= 60
          ? `${Math.ceil(retryAfter / 60)} minute${Math.ceil(retryAfter / 60) > 1 ? 's' : ''}`
          : `${retryAfter} second${retryAfter > 1 ? 's' : ''}`

        toast.error(`Too many requests. Please wait ${waitTime} before trying again.`, {
          duration: 5000,
          description: 'Rate limit exceeded',
        })

        throw new ApiError(message, response.status, data)
      }

      // Skip token refresh for auth endpoints
      // If unauthorized and we haven't retried yet, try to refresh the token
      if (response.status === 401 && retryWithRefresh && !isAuthEndpoint) {
        // Don't attempt to refresh for the refresh endpoint itself
        if (endpoint === '/auth/token/refresh/') {
          throw new ApiError(message, response.status, data)
        }

        try {
          // Use centralized refresh - handles deduplication internally
          const newToken = await performTokenRefresh();

          if (newToken) {
            // Retry the original request with the new token
            return await fetchWithAuth(endpoint, options, false)
          } else {
            // Refresh failed, throw error
            throw new ApiError(message, response.status, data)
          }
        } catch (_refreshError) {
          // If refresh fails, throw the original error
          throw new ApiError(message, response.status, data)
        }
      }

      throw new ApiError(message, response.status, data)
    }

    // Successful request, reset refresh counter
    consecutiveRefreshAttempts = 0
    return data
  } catch (error: unknown) {
    // Re-throw ApiError instances
    if (error instanceof ApiError) {
      throw error
    }

    // Handle network errors
    const errorMessage = error instanceof Error ? error.message : 'Network error'
    throw new ApiError(
      errorMessage,
      0,
      { originalError: error }
    )
  }
}

/**
 * Helper function to handle paginated responses
 * If the response has a 'results' property, it returns the results array
 * Otherwise, it returns the original response
 */
function handlePaginatedResponse<T>(response: unknown): T | T[] {
  // Check if the response is paginated (has a 'results' property)
  if (
    response &&
    typeof response === 'object' &&
    'results' in response &&
    Array.isArray((response as PaginatedResponse<T>).results)
  ) {
    return (response as PaginatedResponse<T>).results
  }
  return response as T
}

/**
 * Fetches all pages of a paginated response and combines the results
 * @param {string} endpoint - The API endpoint to fetch
 * @param {Object} options - Fetch options
 * @returns {Promise<Array>} - Combined results from all pages
 */
async function fetchAllPages<T>(endpoint: string, options: ApiRequestOptions = {}): Promise<T[]> {
  let allResults: T[] = []
  let nextUrl: string | null = endpoint

  while (nextUrl) {
    // Extract the path from the full URL if it's an absolute URL
    let path = nextUrl
    if (nextUrl.startsWith('http')) {
      const url = new URL(nextUrl)
      path = url.pathname + url.search
      // Remove the API_BASE_URL prefix if present since fetchWithAuth will add it back
      if (API_BASE_URL && path.startsWith(API_BASE_URL)) {
        path = path.substring(API_BASE_URL.length)
      }
    }

    // Fetch the current page
    const response = await fetchWithAuth(path, { ...options, method: 'GET' })

    // Add results from this page
    if (
      response &&
      typeof response === 'object' &&
      'results' in response &&
      Array.isArray((response as PaginatedResponse<T>).results)
    ) {
      allResults = [...allResults, ...(response as PaginatedResponse<T>).results]

      // Get the next page URL, if any
      nextUrl = (response as PaginatedResponse<T>).next ?? null
    } else {
      // Not a paginated response, just return it
      return response as T[]
    }
  }

  return allResults
}

/**
 * API client with methods for different request types
 */
function appendQueryParams(
  endpoint: string,
  params?: Record<string, QueryParamValue>,
): string {
  if (!params || typeof params !== 'object') {
    return endpoint
  }
  const searchParams = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') {
      return
    }
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item !== undefined && item !== null && item !== '') {
          searchParams.append(key, String(item))
        }
      })
      return
    }
    searchParams.append(key, String(value))
  })
  const queryString = searchParams.toString()
  if (!queryString) {
    return endpoint
  }
  const separator = endpoint.includes('?') ? '&' : '?'
  return `${endpoint}${separator}${queryString}`
}

export const apiClient: ApiClient = {
  get: async <T = unknown>(endpoint: string, options: ApiRequestOptions = {}): Promise<T | T[]> => {
    const { params, ...rest } = options;
    const url = appendQueryParams(endpoint, params);
    const response = await fetchWithAuth(url, { ...rest, method: 'GET' });
    return handlePaginatedResponse<T>(response);
  },

  /**
   * Get all pages of a paginated response
   * Use this when you need all results from a paginated endpoint
   */
  getAll: <T = unknown>(endpoint: string, options: ApiRequestOptions = {}): Promise<T[]> => {
    const { params, ...rest } = options;
    const url = appendQueryParams(endpoint, params);
    return fetchAllPages<T>(url, rest);
  },

  post: <TResponse = unknown, TPayload = unknown>(
    endpoint: string,
    data?: TPayload,
    options: ApiRequestOptions = {},
  ): Promise<TResponse> =>
    fetchWithAuth(endpoint, { 
      ...options, 
      method: 'POST',
      body: JSON.stringify(data),
    }) as Promise<TResponse>,

  postForm: <TResponse = unknown>(
    endpoint: string,
    formData: FormData,
    options: ApiRequestOptions = {},
  ): Promise<TResponse> =>
    fetchWithAuth(endpoint, {
      ...options,
      method: 'POST',
      body: formData,
    }) as Promise<TResponse>,

  put: <TResponse = unknown, TPayload = unknown>(
    endpoint: string,
    data?: TPayload,
    options: ApiRequestOptions = {},
  ): Promise<TResponse> =>
    fetchWithAuth(endpoint, { 
      ...options, 
      method: 'PUT',
      body: JSON.stringify(data),
    }) as Promise<TResponse>,

  patch: <TResponse = unknown, TPayload = unknown>(
    endpoint: string,
    data?: TPayload,
    options: ApiRequestOptions = {},
  ): Promise<TResponse> =>
    fetchWithAuth(endpoint, { 
      ...options, 
      method: 'PATCH',
      body: JSON.stringify(data),
    }) as Promise<TResponse>,

  delete: <TResponse = unknown>(endpoint: string, options: ApiRequestOptions = {}): Promise<TResponse> =>
    fetchWithAuth(endpoint, { ...options, method: 'DELETE' }) as Promise<TResponse>,

  /**
   * Get the full response including pagination metadata
   * Use this when you need access to pagination info (count, next, previous)
   */
  getWithPagination: <T = unknown>(
    endpoint: string,
    options: ApiRequestOptions = {},
  ): Promise<PaginatedResponse<T> | T> => {
    const { params, ...rest } = options;
    const url = appendQueryParams(endpoint, params);
    return fetchWithAuth(url, { ...rest, method: 'GET' }) as Promise<PaginatedResponse<T> | T>;
  },

  getBlob: (endpoint: string, options: ApiRequestOptions = {}): Promise<Blob> => {
    const { params, ...rest } = options;
    const url = appendQueryParams(endpoint, params);
    return fetchWithAuth(url, { ...rest, method: 'GET', parseAs: 'blob' }) as Promise<Blob>;
  },
}

/**
 * Error handler for API requests
 */
export function handleApiError(error: unknown, defaultMessage = 'An error occurred'): string {
  // Log errors in development only
  if (import.meta.env.DEV) {
    console.error('API Error:', error);
  }

  if (error instanceof ApiError) {
    // For most errors, just return the error message
    return error.message || defaultMessage
  }

  return defaultMessage
}
