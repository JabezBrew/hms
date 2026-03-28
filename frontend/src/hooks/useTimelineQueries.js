import { useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { createKeyFactory, keyWith } from '@/shared/lib/queryKeys';
import { invalidateQueryKeys } from '@/shared/lib/queryInvalidation';

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

function buildTimelineEndpoint(patientId, options = {}) {
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
  return `/clinical-notes/chronicle/${patientId}/timeline/${queryString ? `?${queryString}` : ''}`;
}

function normalizeTimelineEntry(entry) {
  const baseEntry = {
    ...entry,
    author: entry.author ?? entry.author_name ?? '',
    content: entry.content ?? entry.content_summary ?? '',
  };

  if (entry.type === 'note') {
    return {
      ...baseEntry,
      type: entry.note_type || 'progress_note',
      entry_type: 'note',
      template_id: entry.template_id ?? entry.template?.id ?? null,
      template_title: entry.template_title ?? entry.template?.title ?? null,
      data: entry.data ?? {},
    };
  }

  if (entry.type === 'prescription') {
    const medicationData = {
      id: entry.id,
      medication_name: entry.medication_name,
      name: entry.medication_name,
      dosage: entry.dosage,
      dose: entry.dosage,
      route: entry.route,
      route_display: entry.route_display,
      frequency: entry.frequency,
      frequency_display: entry.frequency_display,
      duration_days: entry.duration_days,
      start_date: entry.start_date,
      end_date: entry.end_date,
      instructions: entry.instructions,
      reason: entry.reason,
      status: entry.status,
      status_display: entry.status_display,
      discontinue_reason: entry.discontinue_reason,
    };

    return {
      ...baseEntry,
      type: 'prescription',
      entry_type: 'prescription',
      content: [
        entry.route_display,
        entry.frequency_display,
        entry.duration_days ? `for ${entry.duration_days} days` : null,
      ].filter(Boolean).join(' - '),
      data: medicationData,
    };
  }

  if (entry.type === 'vitals') {
    return {
      ...baseEntry,
      type: 'vitals',
      entry_type: 'vitals',
      data: {
        temperature: entry.temperature,
        heart_rate: entry.heart_rate,
        blood_pressure: entry.blood_pressure,
        blood_pressure_systolic: entry.blood_pressure_systolic,
        blood_pressure_diastolic: entry.blood_pressure_diastolic,
        respiratory_rate: entry.respiratory_rate,
        oxygen_saturation: entry.oxygen_saturation,
        pain_level: entry.pain_level,
        notes: entry.notes,
      },
    };
  }

  if (entry.type === 'lab') {
    return {
      ...baseEntry,
      type: 'lab_result',
      entry_type: 'lab_result',
      data: {
        order_id: entry.id,
        order_number: entry.order_number,
        status: entry.status,
        priority: entry.priority,
        priority_display: entry.priority_display,
        clinical_notes: entry.clinical_notes,
        ordered_at: entry.ordered_at,
        completed_at: entry.completed_at,
        tests_ordered: entry.tests_ordered ?? [],
        results_summary: entry.results_summary ?? null,
        results: entry.results ?? [],
        tests: entry.tests ?? [],
      },
    };
  }

  if (entry.type === 'referral') {
    return {
      ...baseEntry,
      type: 'referral',
      entry_type: 'referral',
      data: {
        referral_number: entry.referral_number,
        status: entry.status,
        status_display: entry.status_display,
        urgency: entry.urgency,
        urgency_display: entry.urgency_display,
        is_urgent: entry.is_urgent,
        referring_department: entry.referring_department,
        referred_to_specialty: entry.referred_to_specialty,
        referred_to_department: entry.referred_to_department,
        referred_to_provider: entry.referred_to_provider_name,
        reason: entry.reason,
        clinical_summary: entry.clinical_summary,
        questions_for_specialist: entry.questions_for_specialist,
        specialist_notes: entry.specialist_notes,
        recommendations: entry.recommendations,
      },
    };
  }

  return baseEntry;
}

function normalizeTimelinePage(data) {
  const page = data ?? {};
  return {
    ...page,
    results: Array.isArray(page.results) ? page.results.map(normalizeTimelineEntry) : [],
  };
}

/**
 * Fetch patient timeline with pagination
 * @param {string} patientId - Patient ID
 * @param {Object} options - Query options (type, search, page_size, start_date, end_date, encounter_id)
 * @returns {Promise} - Paginated timeline data
 */
export async function fetchTimelinePage(patientId, options = {}) {
  const endpoint = buildTimelineEndpoint(patientId, options);

  // Use getWithPagination to get the full response including pagination info
  const data = await apiClient.getWithPagination(endpoint);
  return normalizeTimelinePage(data);
}

/**
 * Fetch patient timeline stats
 * @param {string} patientId - Patient ID
 * @returns {Promise} - Timeline statistics
 */
async function fetchTimelineStats(patientId) {
  return apiClient.get(`/clinical-notes/chronicle/${patientId}/stats/`);
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
    queryFn: ({ pageParam = 1 }) => fetchTimelinePage(patientId, {
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
      queryFn: () => fetchTimelinePage(patientId, { ...options, page: currentPage + 1 }),
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

  return (patientId) => invalidatePatientTimelineQueries(queryClient, patientId);
}

export function invalidatePatientTimelineQueries(queryClient, patientId) {
  if (!patientId) {
    return queryClient.invalidateQueries({ queryKey: timelineKeys.all });
  }

  return invalidateQueryKeys(queryClient, [
    timelineKeys.list(patientId),
    timelineKeys.stats(patientId),
  ]);
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
    queryFn: () => fetchTimelinePage(patientId, {
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
