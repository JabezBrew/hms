import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { drugSafetyApi } from '@/shared/api/drugSafety';
import { createKeyFactory, keyWith } from '@/shared/lib/queryKeys';

// Query keys
const drugSafetyKeyFactory = createKeyFactory('drug-safety');

export const drugSafetyKeys = {
  all: drugSafetyKeyFactory.all,
  allergies: () => keyWith('drug-safety', 'allergies'),
  allergiesList: (filters) => keyWith('drug-safety', 'allergies', 'list', { filters }),
  allergy: (id) => keyWith('drug-safety', 'allergies', id),
  patientAllergies: (patientId) => keyWith('drug-safety', 'allergies', 'patient', patientId),
  alerts: () => keyWith('drug-safety', 'alerts'),
  alertsList: (filters) => keyWith('drug-safety', 'alerts', 'list', { filters }),
  alert: (id) => keyWith('drug-safety', 'alerts', id),
  drugSearch: (query) => keyWith('drug-safety', 'search', query),
  drugForms: (rxcui) => keyWith('drug-safety', 'forms', rxcui),
};

/**
 * Perform drug safety check
 * @returns {Object} Mutation result
 */
export function useSafetyCheck() {
  return useMutation({
    mutationFn: (data) => drugSafetyApi.checkPrescriptionSafety(data),
  });
}

/**
 * Search for drugs using RxNorm
 * @param {string} query - Search query
 * @param {Object} options - Query options
 * @returns {Object} Query result
 */
export function useDrugSearch(query, options = {}) {
  return useQuery({
    queryKey: drugSafetyKeys.drugSearch(query),
    queryFn: () => drugSafetyApi.searchDrugs(query, options.maxResults || 10),
    enabled: !!query && query.length >= 2, // Only search if query is at least 2 characters
    staleTime: 5 * 60 * 1000, // 5 minutes
    ...options,
  });
}

/**
 * Get available drug forms (strengths and dose forms) for a drug
 * @param {string} rxcui - RxNorm Concept Unique Identifier
 * @param {Object} options - Query options
 * @returns {Object} Query result with forms array
 */
export function useDrugForms(rxcui, options = {}) {
  return useQuery({
    queryKey: drugSafetyKeys.drugForms(rxcui),
    queryFn: () => drugSafetyApi.getDrugForms(rxcui),
    enabled: !!rxcui,
    staleTime: 24 * 60 * 60 * 1000, // 24 hours - drug forms don't change often
    ...options,
  });
}

/**
 * Get patient allergies
 * @param {string} patientId - Patient ID
 * @param {Object} options - Query options
 * @param {boolean} options.enabled - Enable/disable the query
 * @returns {Object} Query result
 */
export function usePatientAllergies(patientId, options = {}) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: drugSafetyKeys.patientAllergies(patientId),
    queryFn: () => drugSafetyApi.getPatientAllergies(patientId),
    enabled: !!patientId && enabled,
    staleTime: 60000, // 1 minute - allergies don't change often
    refetchOnWindowFocus: false,
  });
}

/**
 * Get all allergies with optional filtering
 * @param {Object} filters - Query parameters for filtering
 * @returns {Object} Query result
 */
export function useAllergies(filters = {}) {
  return useQuery({
    queryKey: drugSafetyKeys.allergiesList(filters),
    queryFn: () => drugSafetyApi.getAllergies(filters),
  });
}

/**
 * Get a single allergy by ID
 * @param {string} id - Allergy ID
 * @returns {Object} Query result
 */
export function useAllergy(id) {
  return useQuery({
    queryKey: drugSafetyKeys.allergy(id),
    queryFn: () => drugSafetyApi.getAllergy(id),
    enabled: !!id,
  });
}

/**
 * Create a new allergy
 * @returns {Object} Mutation result
 */
export function useCreateAllergy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => drugSafetyApi.createAllergy(data),
    onSuccess: (data) => {
      // Invalidate the allergies list
      queryClient.invalidateQueries({ queryKey: drugSafetyKeys.allergies() });

      // Invalidate patient-specific allergies
      if (data.patient) {
        queryClient.invalidateQueries({
          queryKey: drugSafetyKeys.patientAllergies(data.patient),
        });
      }
    },
  });
}

/**
 * Update an existing allergy
 * @returns {Object} Mutation result
 */
export function useUpdateAllergy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => drugSafetyApi.updateAllergy(id, data),

    // Optimistic update
    onMutate: async ({ id, data }) => {
      await queryClient.cancelQueries({ queryKey: drugSafetyKeys.allergy(id) });

      const previousAllergy = queryClient.getQueryData(drugSafetyKeys.allergy(id));

      queryClient.setQueryData(drugSafetyKeys.allergy(id), (old) => ({
        ...old,
        ...data,
      }));

      return { previousAllergy, id };
    },

    onError: (err, variables, context) => {
      if (context?.previousAllergy) {
        queryClient.setQueryData(
          drugSafetyKeys.allergy(context.id),
          context.previousAllergy
        );
      }
    },

    onSettled: (data, error, variables) => {
      queryClient.invalidateQueries({
        queryKey: drugSafetyKeys.allergy(variables.id),
      });
      queryClient.invalidateQueries({
        queryKey: drugSafetyKeys.allergies(),
      });

      if (data?.patient) {
        queryClient.invalidateQueries({
          queryKey: drugSafetyKeys.patientAllergies(data.patient),
        });
      }
    },
  });
}

/**
 * Delete an allergy
 * @returns {Object} Mutation result
 */
export function useDeleteAllergy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => drugSafetyApi.deleteAllergy(id),
    onSuccess: (data, id) => {
      queryClient.invalidateQueries({
        queryKey: drugSafetyKeys.allergy(id),
      });
      queryClient.invalidateQueries({
        queryKey: drugSafetyKeys.allergies(),
      });
    },
  });
}

/**
 * Verify an allergy (doctors only)
 * @returns {Object} Mutation result
 */
export function useVerifyAllergy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => drugSafetyApi.verifyAllergy(id),
    onSuccess: (data, id) => {
      queryClient.invalidateQueries({
        queryKey: drugSafetyKeys.allergy(id),
      });
      queryClient.invalidateQueries({
        queryKey: drugSafetyKeys.allergies(),
      });

      if (data?.patient) {
        queryClient.invalidateQueries({
          queryKey: drugSafetyKeys.patientAllergies(data.patient),
        });
      }
    },
  });
}

/**
 * Deactivate an allergy
 * @returns {Object} Mutation result
 */
export function useDeactivateAllergy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => drugSafetyApi.deactivateAllergy(id),
    onSuccess: (data, id) => {
      queryClient.invalidateQueries({
        queryKey: drugSafetyKeys.allergy(id),
      });
      queryClient.invalidateQueries({
        queryKey: drugSafetyKeys.allergies(),
      });

      if (data?.patient) {
        queryClient.invalidateQueries({
          queryKey: drugSafetyKeys.patientAllergies(data.patient),
        });
      }
    },
  });
}

/**
 * Get all safety alerts with optional filtering
 * @param {Object} filters - Query parameters for filtering
 * @returns {Object} Query result
 */
export function useAlerts(filters = {}) {
  return useQuery({
    queryKey: drugSafetyKeys.alertsList(filters),
    queryFn: () => drugSafetyApi.getAlerts(filters),
  });
}

/**
 * Get a single safety alert by ID
 * @param {string} id - Alert ID
 * @returns {Object} Query result
 */
export function useAlert(id) {
  return useQuery({
    queryKey: drugSafetyKeys.alert(id),
    queryFn: () => drugSafetyApi.getAlert(id),
    enabled: !!id,
  });
}

/**
 * Override a safety alert (doctors only)
 * @returns {Object} Mutation result
 */
export function useOverrideAlert() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, overrideReason }) => drugSafetyApi.overrideAlert(id, overrideReason),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({
        queryKey: drugSafetyKeys.alert(variables.id),
      });
      queryClient.invalidateQueries({
        queryKey: drugSafetyKeys.alerts(),
      });
    },
  });
}
