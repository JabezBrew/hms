import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { patientsApi } from '@/features/patients/api';
import { useSearchQuery } from '@/hooks/useSearchQuery';
import { immutableMetadataQueryOptions } from '@/lib/react-query';
import { createKeyFactory } from '@/shared/lib/queryKeys';

// Query keys
const baseKeys = createKeyFactory('patients');

export const patientKeys = {
  ...baseKeys,
  history: (id) => [...patientKeys.all, 'history', id],
  recent: () => [...patientKeys.all, 'recent'],
  validation: () => [...patientKeys.all, 'validation'],
  context: (params) => [...patientKeys.all, 'context', params],
  chronicleStartup: (id, params = {}) => [...patientKeys.detail(id), 'chronicle', 'startup', params],
  chronicleTimeline: (id, params = {}) => [...patientKeys.detail(id), 'chronicle', 'timeline', params],
};

const patientSearchKeySalt = (() => {
  const bytes = new Uint32Array(2);
  globalThis.crypto?.getRandomValues?.(bytes);
  return bytes.some(Boolean)
    ? `${bytes[0].toString(36)}${bytes[1].toString(36)}`
    : Math.random().toString(36).slice(2);
})();

function opaqueSearchDigest(value) {
  const input = `${patientSearchKeySalt}:${value}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function opaquePatientSearchScope(value) {
  return {
    present: true,
    length: String(value).length,
    digest: opaqueSearchDigest(String(value)),
  };
}

function sanitizePatientSearchKeyParams(params = {}) {
  const sanitized = { ...params };
  const rawSearch = sanitized.query || sanitized.search || '';
  delete sanitized.query;
  delete sanitized.search;
  delete sanitized.signal;

  if (rawSearch) {
    sanitized.search_scope = opaquePatientSearchScope(rawSearch);
  }

  return sanitized;
}

/**
 * Get patients list with optional filtering
 * @param {Object} filters - Query parameters for filtering
 * @returns {Object} Query result
 */
export function usePatients(filters = {}) {
  return useQuery({
    queryKey: patientKeys.list(filters),
    queryFn: ({ signal }) => patientsApi.getPatients(filters, { signal }),
  });
}

/**
 * Get a single patient by ID (includes FHIR data)
 * @param {string} id - Patient ID
 * @returns {Object} Query result
 */
export function usePatient(id, options = {}) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: patientKeys.detail(id),
    queryFn: ({ signal }) => patientsApi.getPatient(id, { signal }),
    enabled: !!id && enabled, // Only run the query if we have an ID
    staleTime: 5 * 60 * 1000, // 5 minutes - patient demographics don't change frequently
  });
}

/**
 * Get patient demographics only (lightweight, no FHIR)
 * @param {string} id - Patient ID
 * @returns {Object} Query result
 */
export function usePatientDemographics(id, options = {}) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: [...patientKeys.detail(id), 'demographics'],
    queryFn: ({ signal }) => patientsApi.getPatientDemographics(id, { signal }),
    enabled: !!id && enabled,
    staleTime: 5 * 60 * 1000,
  });
}

export function usePatientChronicleStartup(id, params = {}, options = {}) {
  const { enabled = true, staleTime = 30 * 1000 } = options;
  return useQuery({
    queryKey: patientKeys.chronicleStartup(id, params),
    queryFn: ({ signal }) => patientsApi.getPatientChronicleStartup(id, params, { signal }),
    enabled: !!id && enabled,
    staleTime,
    refetchOnWindowFocus: false,
  });
}

export function usePatientChronicleTimeline(id, params = {}, options = {}) {
  const { enabled = true, initialPage } = options;
  return useInfiniteQuery({
    queryKey: patientKeys.chronicleTimeline(id, params),
    queryFn: ({ pageParam = null, signal }) => patientsApi.getPatientChronicleTimeline(
      id,
      {
        ...params,
        cursor: pageParam || undefined,
      },
      { signal },
    ),
    initialPageParam: null,
    getNextPageParam: (lastPage) => (
      lastPage?.has_next ? lastPage.next_cursor : undefined
    ),
    enabled: !!id && enabled,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
    ...(initialPage
      ? {
          initialData: {
            pages: [initialPage],
            pageParams: [null],
          },
        }
      : {}),
  });
}

/**
 * Create a new patient
 * @returns {Object} Mutation result
 */
export function useCreatePatient() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data) => patientsApi.createPatient(data),
    onSuccess: () => {
      // Invalidate the patients list query to refetch
      queryClient.invalidateQueries({ queryKey: patientKeys.lists() });
    },
  });
}

/**
 * Update an existing patient with optimistic updates
 * @returns {Object} Mutation result
 */
export function useUpdatePatient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => patientsApi.updatePatient(id, data),

    // Optimistic update - immediately update UI before server responds
    onMutate: async ({ id, data }) => {
      // Cancel any outgoing refetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: patientKeys.detail(id) });

      // Snapshot the previous value
      const previousPatient = queryClient.getQueryData(patientKeys.detail(id));

      // Optimistically update to the new value
      queryClient.setQueryData(patientKeys.detail(id), (old) => ({
        ...old,
        ...data,
      }));

      // Return context with the previous value for potential rollback
      return { previousPatient, id };
    },

    // If mutation fails, rollback to the previous value
    onError: (err, variables, context) => {
      if (context?.previousPatient) {
        queryClient.setQueryData(
          patientKeys.detail(context.id),
          context.previousPatient
        );
      }
    },

    // Always refetch after error or success to ensure consistency
    onSettled: (data, error, variables) => {
      queryClient.invalidateQueries({
        queryKey: patientKeys.detail(variables.id)
      });
      queryClient.invalidateQueries({
        queryKey: patientKeys.lists()
      });
    },
  });
}

/**
 * Delete a patient with optimistic updates
 * @returns {Object} Mutation result
 */
export function useDeletePatient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => patientsApi.deletePatient(id),

    // Optimistic update - remove from list immediately
    onMutate: async (id) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: patientKeys.lists() });

      // Snapshot the previous value
      const previousLists = queryClient.getQueriesData({
        queryKey: patientKeys.lists()
      });

      // Optimistically remove from all list queries
      queryClient.setQueriesData(
        { queryKey: patientKeys.lists() },
        (old) => {
          if (Array.isArray(old)) {
            return old.filter((patient) => patient.id !== id);
          }
          return old;
        }
      );

      return { previousLists, id };
    },

    // Rollback on error
    onError: (err, variables, context) => {
      if (context?.previousLists) {
        context.previousLists.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
    },

    // Refetch to ensure consistency
    onSettled: (data, error, variables) => {
      queryClient.invalidateQueries({
        queryKey: patientKeys.detail(variables)
      });
      queryClient.invalidateQueries({
        queryKey: patientKeys.lists()
      });
    },
  });
}

/**
 * Get patient medical history
 * @param {string} id - Patient ID
 * @returns {Object} Query result
 */
export function usePatientHistory(id) {
  return useQuery({
    queryKey: patientKeys.history(id),
    queryFn: ({ signal }) => patientsApi.getPatientHistory(id, { signal }),
    enabled: !!id,
  });
}

/**
 * Search patients
 * @param {Object} options - Search options
 * @returns {Object} Search query result
 */
export function useSearchPatients(options = {}) {
  return useSearchQuery(
    [...patientKeys.lists(), 'search'],
    (query, requestOptions) => patientsApi.searchPatients(query, requestOptions),
    {
      staleTime: 1 * 60 * 1000, // Search results stale after 1 minute
      queryKeyForTerm: opaquePatientSearchScope,
      ...options,
    }
  );
}

/**
 * Advanced patient search with explicit params.
 * Use when filters should apply even without a text query.
 * @param {Object} params - Query parameters for search
 * @param {Object} options - Query options
 * @returns {Object} Query result
 */
export function usePatientSearch(params = {}, options = {}) {
  const { enabled = true, staleTime = 60 * 1000 } = options;
  return useQuery({
    queryKey: [...patientKeys.lists(), 'search', sanitizePatientSearchKeyParams(params)],
    queryFn: ({ signal }) => patientsApi.searchPatientsWithMeta(params, { signal }),
    enabled,
    staleTime,
  });
}

/**
 * Get recent patients (limited to 10 by default)
 * @param {number} limit - Maximum number of results (default: 10, max: 20)
 * @returns {Object} Query result
 */
export function useRecentPatients(limit = 10) {
  return useQuery({
    queryKey: [...patientKeys.recent(), { limit }],
    queryFn: ({ signal }) => patientsApi.getRecentPatients({ limit }, { signal }),
    staleTime: 30 * 1000, // 30 seconds - recent patients change frequently
  });
}

/**
 * Get context-specific patients based on user role
 * Returns ward patients for nurses, appointments for doctors, etc.
 * @param {Object} params - Query parameters (e.g., ward for nurses)
 * @returns {Object} Query result
 */
export function useContextPatients(params = {}) {
  return useQuery({
    queryKey: patientKeys.context(params),
    queryFn: ({ signal }) => patientsApi.getContextPatients(params, { signal }),
    staleTime: 60 * 1000, // 1 minute
  });
}

/**
 * Register a new patient
 * @returns {Object} Mutation result
 */
export function useRegisterPatient() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data) => patientsApi.registerPatient(data),
    onSuccess: () => {
      // Invalidate the patients list query to refetch
      queryClient.invalidateQueries({ queryKey: patientKeys.lists() });
    },
  });
}

/**
 * Update a patient with FHIR data
 * @returns {Object} Mutation result
 */
export function useUpdatePatientWithFHIR() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ id, data }) => patientsApi.updatePatientWithFHIR(id, data),
    onSuccess: (data, variables) => {
      if (data) {
        queryClient.setQueryData(patientKeys.detail(variables.id), data);
      }
      // Refetch the specific patient after seeding returned data for immediate navigation.
      queryClient.invalidateQueries({ 
        queryKey: patientKeys.detail(variables.id) 
      });
      // Also invalidate the list to reflect changes
      queryClient.invalidateQueries({ 
        queryKey: patientKeys.lists() 
      });
    },
  });
}

/**
 * Get patient registration validation rules
 * @returns {Object} Query result
 */
export function usePatientValidationRules() {
  return useQuery({
    queryKey: patientKeys.validation(),
    queryFn: ({ signal }) => patientsApi.getValidationRules({ signal }),
    ...immutableMetadataQueryOptions(),
  });
}
