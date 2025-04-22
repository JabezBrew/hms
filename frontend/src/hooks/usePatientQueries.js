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
 * Update an existing patient
 * @returns {Object} Mutation result
 */
export function useUpdatePatient() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ id, data }) => patientsApi.updatePatient(id, data),
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
 * Delete a patient
 * @returns {Object} Mutation result
 */
export function useDeletePatient() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (id) => patientsApi.deletePatient(id),
    onSuccess: (data, variables) => {
      // Invalidate the patient detail query
      queryClient.invalidateQueries({ 
        queryKey: patientKeys.detail(variables) 
      });
      // Also invalidate the list to reflect changes
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