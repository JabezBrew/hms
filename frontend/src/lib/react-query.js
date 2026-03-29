import { QueryClient } from '@tanstack/react-query';

export const IMMUTABLE_METADATA_GC_TIME = 24 * 60 * 60 * 1000;

export function immutableMetadataQueryOptions(overrides = {}) {
  return {
    staleTime: Infinity,
    gcTime: IMMUTABLE_METADATA_GC_TIME,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    ...overrides,
  };
}

export function hasMeaningfulQueryParams(params = {}) {
  if (!params || typeof params !== 'object') {
    return false;
  }

  return Object.values(params).some((value) => {
    if (value === null || value === undefined) {
      return false;
    }

    if (typeof value === 'string') {
      return value.trim() !== '';
    }

    if (Array.isArray(value)) {
      return value.length > 0;
    }

    if (typeof value === 'object') {
      return Object.keys(value).length > 0;
    }

    return true;
  });
}

/**
 * Global React Query client configuration
 * Optimized for hospital management system with balanced performance and data freshness
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // How long until data is considered stale (in milliseconds)
      // 5 minutes - good balance between freshness and performance
      staleTime: 5 * 60 * 1000,

      // How long to keep unused data in cache before garbage collection
      // 30 minutes - keeps recently viewed data accessible
      gcTime: 30 * 60 * 1000,

      // Retry failed queries 1 time before showing error
      // Helps with transient network issues without excessive retries
      retry: 1,

      // Don't refetch on window focus by default
      // Medical data doesn't change that frequently, can be overridden per query
      refetchOnWindowFocus: false,

      // Refetch on reconnect to ensure fresh data after network issues
      // Important for hospital environments with intermittent connectivity
      refetchOnReconnect: true,

      // Refetch interval - disabled by default
      // Can be enabled per query for real-time data (e.g., bed availability)
      refetchInterval: false,
    },
    mutations: {
      // Retry mutations once on failure
      retry: 1,
    },
  },
});
