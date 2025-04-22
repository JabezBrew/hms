import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { encountersApi } from '@/lib/api/encounters';
import { useSearchQuery } from './useSearchQuery';

// Query keys
export const encounterKeys = {
  all: ['encounters'],
  lists: () => [...encounterKeys.all, 'list'],
  list: (filters) => [...encounterKeys.lists(), { filters }],
  details: () => [...encounterKeys.all, 'detail'],
  detail: (id) => [...encounterKeys.details(), id],
  patients: () => [...encounterKeys.all, 'patients'],
  practitioners: () => [...encounterKeys.all, 'practitioners'],
};

/**
 * Get encounters list with optional filtering
 * @param {Object} filters - Query parameters for filtering
 * @returns {Object} Query result
 */
export function useEncounters(filters = {}) {
  return useQuery({
    queryKey: encounterKeys.list(filters),
    queryFn: () => encountersApi.getEncounters(filters),
  });
}

/**
 * Get a single encounter by ID
 * @param {string} id - Encounter ID
 * @returns {Object} Query result
 */
export function useEncounter(id) {
  return useQuery({
    queryKey: encounterKeys.detail(id),
    queryFn: () => encountersApi.getEncounter(id),
    enabled: !!id, // Only run the query if we have an ID
  });
}

/**
 * Create a new encounter
 * @returns {Object} Mutation result
 */
export function useCreateEncounter() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data) => encountersApi.createEncounter(data),
    onSuccess: () => {
      // Invalidate the encounters list query to refetch
      queryClient.invalidateQueries({ queryKey: encounterKeys.lists() });
    },
  });
}

/**
 * Update an existing encounter
 * @returns {Object} Mutation result
 */
export function useUpdateEncounter() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ id, data }) => encountersApi.updateEncounter(id, data),
    onSuccess: (data, variables) => {
      // Update the cache for this specific encounter
      queryClient.invalidateQueries({ 
        queryKey: encounterKeys.detail(variables.id) 
      });
      // Also invalidate the list to reflect changes
      queryClient.invalidateQueries({ 
        queryKey: encounterKeys.lists() 
      });
    },
  });
}

/**
 * Delete an encounter
 * @returns {Object} Mutation result
 */
export function useDeleteEncounter() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (id) => encountersApi.deleteEncounter(id),
    onSuccess: (data, variables) => {
      // Invalidate the encounter detail query
      queryClient.invalidateQueries({ 
        queryKey: encounterKeys.detail(variables) 
      });
      // Also invalidate the list to reflect changes
      queryClient.invalidateQueries({ 
        queryKey: encounterKeys.lists() 
      });
    },
  });
}

/**
 * Discharge a patient (for inpatient encounters)
 * @returns {Object} Mutation result
 */
export function useDischargePatient() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ id, data }) => encountersApi.dischargePatient(id, data),
    onSuccess: (data, variables) => {
      // Update the cache for this specific encounter
      queryClient.invalidateQueries({ 
        queryKey: encounterKeys.detail(variables.id) 
      });
      // Also invalidate the list to reflect changes
      queryClient.invalidateQueries({ 
        queryKey: encounterKeys.lists() 
      });
    },
  });
}

/**
 * Cancel an encounter
 * @returns {Object} Mutation result
 */
export function useCancelEncounter() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (id) => encountersApi.cancelEncounter(id),
    onSuccess: (data, variables) => {
      // Update the cache for this specific encounter
      queryClient.invalidateQueries({ 
        queryKey: encounterKeys.detail(variables) 
      });
      // Also invalidate the list to reflect changes
      queryClient.invalidateQueries({ 
        queryKey: encounterKeys.lists() 
      });
    },
  });
}

/**
 * Search patients for encounter
 * @param {Object} options - Search options
 * @returns {Object} Search query result
 */
export function useSearchPatientsForEncounter(options = {}) {
  return useSearchQuery(
    [...encounterKeys.patients(), 'search'],
    (query) => encountersApi.searchPatients(query),
    {
      staleTime: 1 * 60 * 1000, // Search results stale after 1 minute
      ...options,
    }
  );
}

/**
 * Search practitioners for encounter
 * @param {boolean} doctorsOnly - Whether to filter for doctors only
 * @param {Object} options - Search options
 * @returns {Object} Search query result
 */
export function useSearchPractitioners(doctorsOnly = false, options = {}) {
  return useSearchQuery(
    [...encounterKeys.practitioners(), 'search', { doctorsOnly }],
    (query) => encountersApi.searchPractitioners(query, doctorsOnly),
    {
      staleTime: 5 * 60 * 1000, // Practitioners list changes less frequently
      ...options,
    }
  );
}