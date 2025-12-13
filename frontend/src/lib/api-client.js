/**
 * Base API client for making requests to the backend
 */
import { toast } from 'sonner';

// Base URL for API requests
// In production, use the backend URL. In development, use Vite's proxy.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.PROD ? 'https://backend-production-d15a.up.railway.app/api' : '/api');

const AUTH_ENDPOINTS = [
  '/auth/login/',
  '/auth/register/',
  '/auth/password-reset/',
  '/auth/password-reset/confirm/',
  '/auth/password-reset/validate-token/',
  '/auth/logout/'
];

// Token provider - will be set by the auth context
let getAccessToken = () => null;
let refreshAccessToken = async () => null;

// Flag to track if a token refresh is in progress
let isRefreshing = false;
// Promise to track the current refresh operation
let refreshPromise = null;
// Track consecutive refresh attempts to prevent infinite loops
let consecutiveRefreshAttempts = 0;
const MAX_CONSECUTIVE_REFRESHES = 3;

// Function to set the token provider from the auth context
export function setAuthTokenProvider(tokenGetter, tokenRefresher) {
  getAccessToken = tokenGetter;
  refreshAccessToken = tokenRefresher;
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
  const url = `${API_BASE_URL}${endpoint}`;

  // Get auth token from memory
  const token = getAccessToken();

  // Set default headers
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  // Add auth token if available
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
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
      ...options,
      headers,
      credentials: 'include', // Include cookies for refresh token
    });

    // Parse response data
    let data;
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
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

      // Skip token refresh for auth endpoints or if we're already refreshing
      const isAuthEndpoint = AUTH_ENDPOINTS.some(authPath => endpoint.includes(authPath));

      // If unauthorized and we haven't retried yet, try to refresh the token
      if (response.status === 401 && retryWithRefresh && !isAuthEndpoint) {
        // Don't attempt to refresh the token if we're already trying to refresh it
        // or if this is the token refresh endpoint itself
        if (endpoint === '/auth/token/refresh/') {
          consecutiveRefreshAttempts = 0; // Reset on explicit refresh failure
          throw new ApiError(message, response.status, data);
        }

        // Check if we've exceeded maximum refresh attempts
        if (consecutiveRefreshAttempts >= MAX_CONSECUTIVE_REFRESHES) {
          consecutiveRefreshAttempts = 0;
          throw new ApiError('Maximum authentication attempts exceeded. Please log in again.', response.status, data);
        }

        try {
          consecutiveRefreshAttempts++;

          // If a refresh is already in progress, wait for it to complete
          if (isRefreshing) {
            if (refreshPromise) {
              await refreshPromise;
            } else {
              throw new Error('Token refresh in progress but no promise available');
            }
          } else {
            // Start a new refresh
            isRefreshing = true;
            refreshPromise = refreshAccessToken();

            try {
              await refreshPromise;
              // Refresh succeeded, reset counter
              consecutiveRefreshAttempts = 0;
            } finally {
              isRefreshing = false;
              refreshPromise = null;
            }
          }

          // Retry the original request with the new token
          return await fetchWithAuth(endpoint, options, false);
        } catch (refreshError) {
          // Reset counter on failure
          consecutiveRefreshAttempts = 0;
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

  while (nextUrl) {
    // Extract the path from the full URL if it's an absolute URL
    let path = nextUrl;
    if (nextUrl.startsWith('http')) {
      const url = new URL(nextUrl);
      path = url.pathname + url.search;
      // Remove the API_BASE_URL prefix if present since fetchWithAuth will add it back
      if (API_BASE_URL && path.startsWith(API_BASE_URL)) {
        path = path.substring(API_BASE_URL.length);
      }
    }

    // Fetch the current page
    const response = await fetchWithAuth(path, { ...options, method: 'GET' });

    // Add results from this page
    if (response && typeof response === 'object' && Array.isArray(response.results)) {
      allResults = [...allResults, ...response.results];

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
export const apiClient = {
  get: async (endpoint, options = {}) => {
    const response = await fetchWithAuth(endpoint, { ...options, method: 'GET' });
    return handlePaginatedResponse(response);
  },

  /**
   * Get all pages of a paginated response
   * Use this when you need all results from a paginated endpoint
   */
  getAll: (endpoint, options = {}) => 
    fetchAllPages(endpoint, options),

  post: (endpoint, data, options = {}) => 
    fetchWithAuth(endpoint, { 
      ...options, 
      method: 'POST',
      body: JSON.stringify(data),
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
  getWithPagination: (endpoint, options = {}) =>
    fetchWithAuth(endpoint, { ...options, method: 'GET' }),
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
