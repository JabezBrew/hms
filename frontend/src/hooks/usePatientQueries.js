import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { patientsApi } from '@/lib/api/patients';
import { useSearchQuery } from './useSearchQuery';

// Query keys
export const patientKeys = {
  all: ['patients'],
  lists: () => [...patientKeys.all, 'list'],
  list: (filters) => [...patientKeys.lists(), { filters }],
  details: () => [...patientKeys.all, 'detail'],
  detail: (id) => [...patientKeys.details(), id],
  history: (id) => [...patientKeys.all, 'history', id],
  recent: () => [...patientKeys.all, 'recent'],
  validation: () => [...patientKeys.all, 'validation'],
};

/**
 * Get patients list with optional filtering
 * @param {Object} filters - Query parameters for filtering
 * @returns {Object} Query result
 */
export function usePatients(filters = {}) {
  return useQuery({
    queryKey: patientKeys.list(filters),
    queryFn: () => patientsApi.getPatients(filters),
  });
}

/**
 * Get a single patient by ID
 * @param {string} id - Patient ID
 * @returns {Object} Query result
 */
export function usePatient(id) {
  return useQuery({
    queryKey: patientKeys.detail(id),
    queryFn: () => patientsApi.getPatient(id),
    enabled: !!id, // Only run the query if we have an ID
    staleTime: 5 * 60 * 1000, // 5 minutes - patient demographics don't change frequently
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
    queryFn: () => patientsApi.getPatientHistory(id),
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
    (query) => patientsApi.searchPatients(query),
    {
      staleTime: 1 * 60 * 1000, // Search results stale after 1 minute
      ...options,
    }
  );
}

/**
 * Get recent patients
 * @returns {Object} Query result
 */
export function useRecentPatients() {
  return useQuery({
    queryKey: patientKeys.recent(),
    queryFn: () => patientsApi.getRecentPatients(),
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
      // Update the cache for this specific patient
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
    queryFn: () => patientsApi.getValidationRules(),
    staleTime: 24 * 60 * 60 * 1000, // 24 hours - validation rules rarely change
  });
}