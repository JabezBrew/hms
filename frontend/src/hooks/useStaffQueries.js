import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { staffApi } from '@/features/staff/api';
import { useSearchQuery } from './useSearchQuery';
import { createKeyFactory, keyWith } from '@/shared/lib/queryKeys';

// Query keys
const staffKeyFactory = createKeyFactory('staff');

export const staffKeys = {
  all: staffKeyFactory.all,
  lists: staffKeyFactory.lists,
  list: (filters) => staffKeyFactory.list(filters),
  search: () => keyWith('staff', 'search'),
  details: staffKeyFactory.details,
  detail: (id) => staffKeyFactory.detail(id),
  practitioners: () => keyWith('staff', 'practitioners'),
  practitionersList: (filters) => keyWith('staff', 'practitioners', 'list', { filters }),
  practitioner: (id) => keyWith('staff', 'practitioners', id),
};

/**
 * Get staff list with optional filtering
 * @param {Object} filters - Query parameters for filtering
 * @returns {Object} Query result
 */
export function useStaff(filters = {}) {
  return useQuery({
    queryKey: staffKeys.list(filters),
    queryFn: () => staffApi.getStaff(filters),
  });
}

/**
 * Get a single staff member by ID
 * @param {string} id - Staff ID
 * @returns {Object} Query result
 */
export function useStaffMember(id) {
  return useQuery({
    queryKey: staffKeys.detail(id),
    queryFn: () => staffApi.getStaffMember(id),
    enabled: !!id, // Only run the query if we have an ID
  });
}

/**
 * Create a new staff member
 * @returns {Object} Mutation result
 */
export function useCreateStaff() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data) => staffApi.createStaff(data),
    onSuccess: () => {
      // Invalidate the staff list query to refetch
      queryClient.invalidateQueries({ queryKey: staffKeys.lists() });
      
      // Also invalidate practitioners list if the new staff member might be a practitioner
      queryClient.invalidateQueries({ queryKey: staffKeys.practitioners() });
    },
  });
}

/**
 * Update an existing staff member
 * @returns {Object} Mutation result
 */
export function useUpdateStaff() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => staffApi.updateStaff(id, data),

    // Optimistic update - immediately update UI before server responds
    onMutate: async ({ id, data }) => {
      // Cancel any outgoing refetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: staffKeys.detail(id) });

      // Snapshot the previous value
      const previousStaff = queryClient.getQueryData(staffKeys.detail(id));

      // Optimistically update to the new value
      queryClient.setQueryData(staffKeys.detail(id), (old) => ({
        ...old,
        ...data,
      }));

      // Return context with the previous value for potential rollback
      return { previousStaff, id };
    },

    // If mutation fails, rollback to the previous value
    onError: (err, variables, context) => {
      if (context?.previousStaff) {
        queryClient.setQueryData(
          staffKeys.detail(context.id),
          context.previousStaff
        );
      }
    },

    // Always refetch after error or success to ensure consistency
    onSettled: (data, error, variables) => {
      queryClient.invalidateQueries({
        queryKey: staffKeys.detail(variables.id)
      });
      queryClient.invalidateQueries({
        queryKey: staffKeys.lists()
      });

      // If the staff member is a practitioner, also invalidate practitioner queries
      if (data && (data.role === 'doctor' || data.role === 'nurse')) {
        queryClient.invalidateQueries({
          queryKey: staffKeys.practitioners()
        });

        // If we know the practitioner ID, invalidate that specific practitioner
        if (data.practitioner_id) {
          queryClient.invalidateQueries({
            queryKey: staffKeys.practitioner(data.practitioner_id)
          });
        }
      }
    },
  });
}

/**
 * Delete a staff member
 * @returns {Object} Mutation result
 */
export function useDeleteStaff() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (id) => staffApi.deleteStaff(id),
    onSuccess: (data, variables) => {
      // Invalidate the staff detail query
      queryClient.invalidateQueries({ 
        queryKey: staffKeys.detail(variables) 
      });
      // Also invalidate the list to reflect changes
      queryClient.invalidateQueries({ 
        queryKey: staffKeys.lists() 
      });
      
      // Also invalidate practitioners list since the deleted staff might be a practitioner
      queryClient.invalidateQueries({ 
        queryKey: staffKeys.practitioners() 
      });
    },
  });
}

/**
 * Register a new staff member
 * @returns {Object} Mutation result
 */
export function useRegisterStaff() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data) => staffApi.registerStaff(data),
    onSuccess: () => {
      // Invalidate the staff list query to refetch
      queryClient.invalidateQueries({ queryKey: staffKeys.lists() });
      
      // Also invalidate practitioners list if the new staff member might be a practitioner
      queryClient.invalidateQueries({ queryKey: staffKeys.practitioners() });
    },
  });
}

/**
 * Reactivate a deprovisioned staff account
 * @returns {Object} Mutation result
 */
export function useReactivateStaff() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (staffId) => staffApi.reactivateStaff(staffId),
    onSuccess: (data, staffId) => {
      queryClient.invalidateQueries({ queryKey: staffKeys.detail(staffId) });
      queryClient.invalidateQueries({ queryKey: staffKeys.lists() });
      queryClient.invalidateQueries({ queryKey: staffKeys.practitioners() });

      const reactivatedStaff = data?.staff;
      if (reactivatedStaff?.id) {
        queryClient.setQueryData(staffKeys.detail(reactivatedStaff.id), reactivatedStaff);
      }
    },
  });
}

/**
 * Resend setup/reset link for an existing staff account
 * @returns {Object} Mutation result
 */
export function useResendStaffSetupLink() {
  return useMutation({
    mutationFn: (staffId) => staffApi.resendSetupLink(staffId),
  });
}

/**
 * Get practitioners list with optional filtering
 * @param {Object} filters - Query parameters for filtering
 * @returns {Object} Query result
 */
export function usePractitioners(filters = {}) {
  return useQuery({
    queryKey: staffKeys.practitionersList(filters),
    queryFn: () => staffApi.getPractitioners(filters),
  });
}

/**
 * Get a single practitioner by ID
 * @param {string} id - Practitioner ID
 * @returns {Object} Query result
 */
export function usePractitioner(id) {
  return useQuery({
    queryKey: staffKeys.practitioner(id),
    queryFn: () => staffApi.getPractitioner(id),
    enabled: !!id,
  });
}

/**
 * Search practitioners
 * @param {boolean} doctorsOnly - Whether to filter for doctors only
 * @param {Object} options - Search options
 * @returns {Object} Search query result
 */
export function useSearchPractitioners(doctorsOnly = false, options = {}) {
  return useSearchQuery(
    [...staffKeys.practitioners(), 'search', { doctorsOnly }],
    (query) => staffApi.searchPractitioners(query, doctorsOnly),
    {
      staleTime: 5 * 60 * 1000, // 5 minutes - practitioners list changes less frequently
      ...options,
    }
  );
}

/**
 * Search staff (local only) by name or employee ID
 * @param {Object} filters - Optional filters
 * @param {Object} options - Search options
 * @returns {Object} Search query result
 */
export function useSearchStaff(filters = {}, options = {}) {
  return useSearchQuery(
    [...staffKeys.search(), { filters }],
    (query) => staffApi.searchStaff(query, filters),
    {
      staleTime: 60 * 1000,
      ...options,
    }
  );
}
