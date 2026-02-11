/**
 * useChronicleContext - Hook for fetching patient chronicle context data
 *
 * Returns consolidated patient info, allergies, active problems,
 * active medications, and admission status in a single call.
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { createKeyFactory, keyWith } from '@/shared/lib/queryKeys';

// Query keys
const chronicleKeyFactory = createKeyFactory('chronicle');

export const chronicleKeys = {
  all: chronicleKeyFactory.all,
  context: (patientId) => keyWith('chronicle', 'context', patientId),
  timeline: (patientId, filters) => keyWith('chronicle', 'timeline', patientId, filters),
};

/**
 * Fetch patient chronicle context (Tier 1 data)
 *
 * Consolidates:
 * - Patient info (id, mrn, name, age, gender, etc.)
 * - Allergies
 * - Active problems
 * - Active medications
 * - Admission status
 * - Active encounter
 */
export function useChronicleContext(patientId, options = {}) {
  return useQuery({
    queryKey: chronicleKeys.context(patientId),
    queryFn: async () => {
      const response = await apiClient.get(`/clinical-notes/chronicle/${patientId}/context/`);
      // apiClient.get returns data directly, not wrapped in response.data
      const data = response?.data ?? response;
      return data ?? {};
    },
    enabled: !!patientId && (options.enabled !== false),
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
    ...options,
  });
}

/**
 * Fetch patient timeline v2 (Tier 2 data)
 *
 * Uses TimelineEvent for efficient pagination while returning full details.
 *
 * @param {string} patientId - Patient UUID
 * @param {object} filters - Query filters
 * @param {string} filters.type - Filter by type (notes, vitals, prescriptions, labs, referrals, all)
 * @param {string} filters.search - Text search
 * @param {number} filters.page - Page number (default: 1)
 * @param {number} filters.pageSize - Items per page (default: 20)
 * @param {string} filters.startDate - Filter from date (ISO format)
 * @param {string} filters.endDate - Filter until date (ISO format)
 * @param {string} filters.encounterId - Filter by encounter
 */
export function useTimelineV2(patientId, filters = {}, options = {}) {
  const {
    type = 'all',
    search = '',
    page = 1,
    pageSize = 20,
    startDate,
    endDate,
    encounterId,
  } = filters;

  return useQuery({
    // Use primitive values in query key to prevent duplicate calls
    queryKey: keyWith('chronicle', 'timeline', patientId, type, search, page, pageSize, startDate, endDate, encounterId),
    queryFn: async () => {
      const params = new URLSearchParams();
      if (type && type !== 'all') params.append('type', type);
      if (search) params.append('search', search);
      params.append('page', page.toString());
      params.append('page_size', pageSize.toString());
      if (startDate) params.append('start_date', startDate);
      if (endDate) params.append('end_date', endDate);
      if (encounterId) params.append('encounter_id', encounterId);

      const response = await apiClient.get(
        `/clinical-notes/chronicle/${patientId}/timeline/?${params.toString()}`
      );
      // apiClient.get returns data directly, not wrapped in response.data
      const data = response?.data ?? response;
      return data ?? { results: [], count: 0 };
    },
    enabled: !!patientId && (options.enabled !== false),
    staleTime: 30 * 1000, // 30 seconds
    refetchOnWindowFocus: false,
    ...options,
  });
}
