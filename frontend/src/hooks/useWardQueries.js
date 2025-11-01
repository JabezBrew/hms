import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { wardsApi } from '@/lib/api/wards';

// Query keys
export const wardKeys = {
  all: ['wards'],
  lists: () => [...wardKeys.all, 'list'],
  list: (filters) => [...wardKeys.lists(), { filters }],
  details: () => [...wardKeys.all, 'detail'],
  detail: (id) => [...wardKeys.details(), id],
  beds: () => [...wardKeys.all, 'beds'],
  bedsList: (filters) => [...wardKeys.beds(), 'list', { filters }],
  bed: (id) => [...wardKeys.beds(), id],
  wardBeds: (wardId, filters) => [...wardKeys.detail(wardId), 'beds', { filters }],
  transfers: () => [...wardKeys.all, 'transfers'],
  transfersList: (filters) => [...wardKeys.transfers(), 'list', { filters }],
  allocationLogs: () => [...wardKeys.all, 'allocationLogs'],
  allocationLogsList: (filters) => [...wardKeys.allocationLogs(), 'list', { filters }],
  admissions: () => [...wardKeys.all, 'admissions'],
  admissionsList: (filters) => [...wardKeys.admissions(), 'list', { filters }],
  admission: (id) => [...wardKeys.admissions(), id],
};

/**
 * Get wards API root information
 * @returns {Object} Query result
 */
export function useWardsRoot() {
  return useQuery({
    queryKey: wardKeys.all,
    queryFn: () => wardsApi.getWardsRoot(),
  });
}

/**
 * Get wards list with optional filtering
 * @param {Object} filters - Query parameters for filtering
 * @returns {Object} Query result
 */
export function useWards(filters = {}) {
  return useQuery({
    queryKey: wardKeys.list(filters),
    queryFn: () => wardsApi.getWards(filters),
  });
}

/**
 * Get a single ward by ID
 * @param {string} id - Ward ID
 * @returns {Object} Query result
 */
export function useWard(id) {
  return useQuery({
    queryKey: wardKeys.detail(id),
    queryFn: () => wardsApi.getWard(id),
    enabled: !!id, // Only run the query if we have an ID

  });
}

/**
 * Create a new ward (admin only)
 * @returns {Object} Mutation result
 */
export function useCreateWard() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => wardsApi.createWard(data),
    onSuccess: () => {
      // Invalidate the wards list query to refetch
      queryClient.invalidateQueries({ queryKey: wardKeys.lists() });
    },
  });
}

/**
 * Update an existing ward (admin only)
 * @returns {Object} Mutation result
 */
export function useUpdateWard() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => wardsApi.updateWard(id, data),

    // Optimistic update - immediately update UI before server responds
    onMutate: async ({ id, data }) => {
      // Cancel any outgoing refetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: wardKeys.detail(id) });

      // Snapshot the previous value
      const previousWard = queryClient.getQueryData(wardKeys.detail(id));

      // Optimistically update to the new value
      queryClient.setQueryData(wardKeys.detail(id), (old) => ({
        ...old,
        ...data,
      }));

      // Return context with the previous value for potential rollback
      return { previousWard, id };
    },

    // If mutation fails, rollback to the previous value
    onError: (err, variables, context) => {
      if (context?.previousWard) {
        queryClient.setQueryData(
          wardKeys.detail(context.id),
          context.previousWard
        );
      }
    },

    // Always refetch after error or success to ensure consistency
    onSettled: (data, error, variables) => {
      queryClient.invalidateQueries({
        queryKey: wardKeys.detail(variables.id)
      });
      queryClient.invalidateQueries({
        queryKey: wardKeys.lists()
      });
    },
  });
}

/**
 * Delete a ward (admin only)
 * @returns {Object} Mutation result
 */
export function useDeleteWard() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => wardsApi.deleteWard(id),
    onSuccess: (data, variables) => {
      // Invalidate the ward detail query
      queryClient.invalidateQueries({ 
        queryKey: wardKeys.detail(variables) 
      });
      // Also invalidate the list to reflect changes
      queryClient.invalidateQueries({ 
        queryKey: wardKeys.lists() 
      });
    },
  });
}

/**
 * Get beds list with optional filtering
 * @param {Object} filters - Query parameters for filtering
 * @returns {Object} Query result
 */
export function useBeds(filters = {}) {
  return useQuery({
    queryKey: wardKeys.bedsList(filters),
    queryFn: () => wardsApi.getBeds(filters),
  });
}

/**
 * Get beds for a specific ward
 * @param {string} wardId - Ward ID
 * @param {Object} filters - Additional query parameters
 * @returns {Object} Query result
 */
export function useWardBeds(wardId, filters = {}) {
  return useQuery({
    queryKey: wardKeys.wardBeds(wardId, filters),
    queryFn: () => wardsApi.getBeds({ ward: wardId, ...filters }),
    enabled: !!wardId,
  });
}

/**
 * Get a single bed by ID
 * @param {string} id - Bed ID
 * @returns {Object} Query result
 */
export function useBed(id) {
  return useQuery({
    queryKey: wardKeys.bed(id),
    queryFn: () => wardsApi.getBed(id),
    enabled: !!id,
  });
}

/**
 * Create a new bed (admin only)
 * @returns {Object} Mutation result
 */
export function useCreateBed() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => wardsApi.createBed(data),
    onSuccess: (data) => {
      // Invalidate the beds list query to refetch
      queryClient.invalidateQueries({ queryKey: wardKeys.beds() });

      // If the bed has a ward, also invalidate that ward's beds
      if (data && data.ward) {
        queryClient.invalidateQueries({ 
          queryKey: wardKeys.wardBeds(data.ward) 
        });
      }
    },
  });
}

/**
 * Update an existing bed (admin only)
 * @returns {Object} Mutation result
 */
export function useUpdateBed() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => wardsApi.updateBed(id, data),
    onSuccess: (responseData, variables) => {
      // Update the cache for this specific bed
      queryClient.invalidateQueries({ 
        queryKey: wardKeys.bed(variables.id) 
      });

      // Invalidate the beds list
      queryClient.invalidateQueries({ 
        queryKey: wardKeys.beds() 
      });

      // If the bed has a ward, also invalidate that ward's beds
      if (responseData && responseData.ward) {
        queryClient.invalidateQueries({ 
          queryKey: wardKeys.wardBeds(responseData.ward) 
        });
      }

      // If the bed was moved from one ward to another, invalidate both wards
      if (variables.data && variables.data.ward && responseData && responseData.ward !== variables.data.ward) {
        queryClient.invalidateQueries({ 
          queryKey: wardKeys.wardBeds(variables.data.ward) 
        });
      }
    },
  });
}

/**
 * Delete a bed (admin only)
 * @returns {Object} Mutation result
 */
export function useDeleteBed() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, wardId }) => {
      // wardId is optional and used only for cache invalidation
      return wardsApi.deleteBed(id);
    },
    onSuccess: (data, variables) => {
      // Invalidate the bed detail query
      queryClient.invalidateQueries({ 
        queryKey: wardKeys.bed(variables.id) 
      });

      // Invalidate the beds list
      queryClient.invalidateQueries({ 
        queryKey: wardKeys.beds() 
      });

      // If wardId was provided, invalidate that ward's beds
      if (variables.wardId) {
        queryClient.invalidateQueries({ 
          queryKey: wardKeys.wardBeds(variables.wardId) 
        });
      }
    },
  });
}

/**
 * Get transfers list with optional filtering
 * @param {Object} filters - Query parameters for filtering
 * @returns {Object} Query result
 */
export function useTransfers(filters = {}) {
  return useQuery({
    queryKey: wardKeys.transfersList(filters),
    queryFn: () => wardsApi.getTransfers(filters),
  });
}

/**
 * Create a new transfer
 * @returns {Object} Mutation result
 */
export function useCreateTransfer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => wardsApi.createTransfer(data),
    onSuccess: (data) => {
      // Invalidate the transfers list
      queryClient.invalidateQueries({ 
        queryKey: wardKeys.transfers() 
      });

      // Invalidate the beds lists since bed assignments may have changed
      queryClient.invalidateQueries({ 
        queryKey: wardKeys.beds() 
      });

      // If we know the source and destination wards, invalidate their beds too
      if (data) {
        if (data.source_ward) {
          queryClient.invalidateQueries({ 
            queryKey: wardKeys.wardBeds(data.source_ward) 
          });
        }
        if (data.destination_ward) {
          queryClient.invalidateQueries({ 
            queryKey: wardKeys.wardBeds(data.destination_ward) 
          });
        }
      }
    },
  });
}

/**
 * Get admissions list with optional filtering
 * @param {Object} filters - Query parameters for filtering
 * @param {Object} options - Additional query options
 * @returns {Object} Query result
 */
export function useAdmissions(filters = {}, options = {}) {
  return useQuery({
    queryKey: wardKeys.admissionsList(filters),
    queryFn: () => wardsApi.getAdmissions(filters),
    ...options,
  });
}

/**
 * Get allocation logs list with optional filtering
 * @param {Object} filters - Query parameters for filtering
 * @returns {Object} Query result
 */
export function useAllocationLogs(filters = {}) {
  return useQuery({
    queryKey: wardKeys.allocationLogsList(filters),
    queryFn: () => wardsApi.getAllocationLogs(filters),
  });
}
