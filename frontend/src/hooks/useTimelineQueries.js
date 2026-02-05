import { useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { createKeyFactory, keyWith } from '@/shared/lib/queryKeys';

// Query keys for timeline data
const timelineKeyFactory = createKeyFactory('timeline');

export const timelineKeys = {
  all: timelineKeyFactory.all,
  list: (patientId) => keyWith('timeline', 'list', patientId),
  listParams: (patientId, type, search, pageSize, startDate, endDate, encounterId) =>
    keyWith('timeline', 'list', patientId, type, search, pageSize, startDate, endDate, encounterId),
  filtered: (patientId, filters) => keyWith('timeline', 'list', patientId, { filters }),
  stats: (patientId) => keyWith('timeline', 'stats', patientId),
};

/**
 * Fetch patient timeline with pagination
 * @param {string} patientId - Patient ID
 * @param {Object} options - Query options (type, search, page_size, start_date, end_date, encounter_id)
 * @returns {Promise} - Paginated timeline data
 */
async function fetchTimeline(patientId, options = {}) {
  const params = new URLSearchParams();

  if (options.type && options.type !== 'all') {
    params.append('type', options.type);
  }
  if (options.search) {
    params.append('search', options.search);
  }
  if (options.page) {
    params.append('page', options.page.toString());
  }
  if (options.page_size) {
    params.append('page_size', options.page_size.toString());
  }
  if (options.start_date) {
    params.append('start_date', options.start_date);
  }
  if (options.end_date) {
    params.append('end_date', options.end_date);
  }
  if (options.encounter_id) {
    params.append('encounter_id', options.encounter_id);
  }

  const queryString = params.toString();
  const endpoint = `/clinical-notes/timeline/${patientId}/${queryString ? `?${queryString}` : ''}`;

  // Use getWithPagination to get the full response including pagination info
  return apiClient.getWithPagination(endpoint);
}

/**
 * Fetch patient timeline stats
 * @param {string} patientId - Patient ID
 * @returns {Promise} - Timeline statistics
 */
async function fetchTimelineStats(patientId) {
  return apiClient.get(`/clinical-notes/timeline/${patientId}/stats/`);
}

/**
 * Hook for fetching patient timeline with infinite scroll
 * @param {string} patientId - Patient ID
 * @param {Object} options - Query options
 * @param {string} options.type - Filter by type (all, notes, vitals, prescriptions)
 * @param {string} options.search - Search query
 * @param {number} options.pageSize - Items per page (default: 20)
 * @param {string} options.startDate - Start date filter (ISO format)
 * @param {string} options.endDate - End date filter (ISO format)
 * @param {string} options.encounterId - Filter by specific encounter
 * @returns {Object} - Infinite query result with timeline entries
 */
export function usePatientTimeline(patientId, options = {}) {
  const {
    type = 'all',
    search = '',
    pageSize = 20,
    startDate,
    endDate,
    encounterId,
    enabled = true,
  } = options;

  return useInfiniteQuery({
    // Use primitive values in query key to prevent unnecessary refetches
    // React Query does deep comparison but object identity changes can cause issues
    queryKey: timelineKeys.listParams(patientId, type, search, pageSize, startDate, endDate, encounterId),
    queryFn: ({ pageParam = 1 }) => fetchTimeline(patientId, {
      type,
      search,
      page: pageParam,
      page_size: pageSize,
      start_date: startDate,
      end_date: endDate,
      encounter_id: encounterId,
    }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      // Return the next page number if there are more pages
      if (lastPage.has_next) {
        return lastPage.page + 1;
      }
      return undefined;
    },
    getPreviousPageParam: (firstPage) => {
      // Return the previous page number if available
      if (firstPage.has_previous) {
        return firstPage.page - 1;
      }
      return undefined;
    },
    enabled: !!patientId && enabled,
    staleTime: 30000, // Consider data stale after 30 seconds
    refetchOnWindowFocus: false, // Disable - use manual refresh instead to prevent duplicate calls
  });
}

/**
 * Hook for fetching patient timeline stats
 * @param {string} patientId - Patient ID
 * @returns {Object} - Query result with timeline statistics
 */
export function useTimelineStats(patientId) {
  return useQuery({
    queryKey: timelineKeys.stats(patientId),
    queryFn: () => fetchTimelineStats(patientId),
    enabled: !!patientId,
    staleTime: 60000, // Stats are stale after 1 minute
  });
}

/**
 * Hook to prefetch next page of timeline
 * @param {string} patientId - Patient ID
 * @param {Object} options - Current query options
 * @param {number} currentPage - Current page number
 */
export function usePrefetchTimelinePage(patientId, options, currentPage) {
  const queryClient = useQueryClient();

  const prefetchNextPage = () => {
    queryClient.prefetchQuery({
      queryKey: timelineKeys.filtered(patientId, { ...options, page: currentPage + 1 }),
      queryFn: () => fetchTimeline(patientId, { ...options, page: currentPage + 1 }),
    });
  };

  return { prefetchNextPage };
}

/**
 * Hook to invalidate timeline cache (useful after creating notes, vitals, prescriptions)
 * @returns {Function} - Function to invalidate timeline cache
 */
export function useInvalidateTimeline() {
  const queryClient = useQueryClient();

  return (patientId) => {
    if (patientId) {
      // Invalidate timeline list queries for this patient
      queryClient.invalidateQueries({ queryKey: timelineKeys.list(patientId) });
      queryClient.invalidateQueries({ queryKey: timelineKeys.stats(patientId) });
    } else {
      queryClient.invalidateQueries({ queryKey: timelineKeys.all });
    }
  };
}

/**
 * Helper function to flatten paginated timeline results
 * @param {Object} data - Data from useInfiniteQuery
 * @returns {Array} - Flattened array of timeline entries
 */
export function flattenTimelinePages(data) {
  if (!data?.pages) return [];
  return data.pages.flatMap(page => page.results || []);
}

/**
 * Helper function to get total count from paginated timeline
 * @param {Object} data - Data from useInfiniteQuery
 * @returns {number} - Total count of entries
 */
export function getTimelineTotalCount(data) {
  if (!data?.pages?.[0]) return 0;
  return data.pages[0].count || 0;
}

/**
 * Hook for simple timeline fetch (non-infinite, useful for sidebars)
 * @param {string} patientId - Patient ID
 * @param {Object} options - Query options
 * @returns {Object} - Query result with timeline entries
 */
export function usePatientTimelineSimple(patientId, options = {}) {
  const {
    type = 'all',
    search = '',
    pageSize = 10,
    page = 1,
    enabled = true,
  } = options;

  return useQuery({
    queryKey: timelineKeys.filtered(patientId, { type, search, pageSize, page, simple: true }),
    queryFn: () => fetchTimeline(patientId, {
      type,
      search,
      page,
      page_size: pageSize,
    }),
    enabled: !!patientId && enabled,
    staleTime: 30000,
    select: (data) => data.results || [],
  });
}
