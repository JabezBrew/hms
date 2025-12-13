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
  availableBeds: (filters) => [...wardKeys.beds(), 'available', { filters }],
  transfers: () => [...wardKeys.all, 'transfers'],
  transfersList: (filters) => [...wardKeys.transfers(), 'list', { filters }],
  allocationLogs: () => [...wardKeys.all, 'allocationLogs'],
  allocationLogsList: (filters) => [...wardKeys.allocationLogs(), 'list', { filters }],
  admissions: () => [...wardKeys.all, 'admissions'],
  admissionsList: (filters) => [...wardKeys.admissions(), 'list', { filters }],
  admission: (id) => [...wardKeys.admissions(), id],
  sections: () => [...wardKeys.all, 'sections'],
  sectionsList: (filters) => [...wardKeys.sections(), 'list', { filters }],
  section: (id) => [...wardKeys.sections(), id],
  wardSections: (wardId) => [...wardKeys.detail(wardId), 'sections'],
  sectionBeds: (sectionId) => [...wardKeys.section(sectionId), 'beds'],
  amenities: () => [...wardKeys.all, 'amenities'],
  amenitiesList: (filters) => [...wardKeys.amenities(), 'list', { filters }],
  amenity: (id) => [...wardKeys.amenities(), id],
  staff: () => [...wardKeys.all, 'staff'],
  wardStaff: (wardId, category) => [...wardKeys.detail(wardId), 'staff', { category }],
  staffAssignments: () => [...wardKeys.all, 'staffAssignments'],
  staffAssignmentsList: (filters) => [...wardKeys.staffAssignments(), 'list', { filters }],
  staffAssignment: (id) => [...wardKeys.staffAssignments(), id],
  practitionerAssignments: (practitionerId) => [...wardKeys.staffAssignments(), 'practitioner', practitionerId],
  staffRoles: () => [...wardKeys.all, 'staffRoles'],
  staffRolesList: (filters) => [...wardKeys.staffRoles(), 'list', { filters }],
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

// =============================================================================
// WARD SECTIONS HOOKS
// =============================================================================

/**
 * Get all ward sections with optional filtering
 * @param {Object} filters - Query parameters for filtering
 * @param {Object} options - Additional query options
 * @returns {Object} Query result
 */
export function useSections(filters = {}, options = {}) {
  return useQuery({
    queryKey: wardKeys.sectionsList(filters),
    queryFn: () => wardsApi.getSections(filters),
    ...options,
  });
}

/**
 * Get sections for a specific ward
 * @param {string} wardId - Ward ID
 * @param {Object} options - Additional query options
 * @returns {Object} Query result
 */
export function useWardSections(wardId, options = {}) {
  return useQuery({
    queryKey: wardKeys.wardSections(wardId),
    queryFn: () => wardsApi.getWardSections(wardId),
    enabled: !!wardId,
    ...options,
  });
}

/**
 * Get a single section by ID
 * @param {string} id - Section ID
 * @param {Object} options - Additional query options
 * @returns {Object} Query result
 */
export function useSection(id, options = {}) {
  return useQuery({
    queryKey: wardKeys.section(id),
    queryFn: () => wardsApi.getSection(id),
    enabled: !!id,
    ...options,
  });
}

/**
 * Get beds in a specific section
 * @param {string} sectionId - Section ID
 * @param {Object} options - Additional query options
 * @returns {Object} Query result
 */
export function useSectionBeds(sectionId, options = {}) {
  return useQuery({
    queryKey: wardKeys.sectionBeds(sectionId),
    queryFn: () => wardsApi.getSectionBeds(sectionId),
    enabled: !!sectionId,
    ...options,
  });
}

/**
 * Create a new ward section (admin only)
 * @returns {Object} Mutation result
 */
export function useCreateSection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => wardsApi.createSection(data),
    onSuccess: (data) => {
      // Invalidate sections list
      queryClient.invalidateQueries({ queryKey: wardKeys.sections() });

      // If section has a ward, invalidate that ward's sections
      if (data && data.ward) {
        queryClient.invalidateQueries({
          queryKey: wardKeys.wardSections(data.ward)
        });
        // Also invalidate the ward detail
        queryClient.invalidateQueries({
          queryKey: wardKeys.detail(data.ward)
        });
      }
    },
  });
}

/**
 * Update an existing ward section (admin only)
 * @returns {Object} Mutation result
 */
export function useUpdateSection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => wardsApi.updateSection(id, data),
    onSuccess: (responseData, variables) => {
      // Update the cache for this specific section
      queryClient.invalidateQueries({
        queryKey: wardKeys.section(variables.id)
      });

      // Invalidate sections list
      queryClient.invalidateQueries({
        queryKey: wardKeys.sections()
      });

      // If section has a ward, invalidate that ward's sections
      if (responseData && responseData.ward) {
        queryClient.invalidateQueries({
          queryKey: wardKeys.wardSections(responseData.ward)
        });
        queryClient.invalidateQueries({
          queryKey: wardKeys.detail(responseData.ward)
        });
      }
    },
  });
}

/**
 * Delete a ward section (admin only)
 * @returns {Object} Mutation result
 */
export function useDeleteSection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, wardId }) => {
      // wardId is optional and used only for cache invalidation
      return wardsApi.deleteSection(id);
    },
    onSuccess: (data, variables) => {
      // Invalidate the section detail query
      queryClient.invalidateQueries({
        queryKey: wardKeys.section(variables.id)
      });

      // Invalidate sections list
      queryClient.invalidateQueries({
        queryKey: wardKeys.sections()
      });

      // If wardId was provided, invalidate that ward's sections
      if (variables.wardId) {
        queryClient.invalidateQueries({
          queryKey: wardKeys.wardSections(variables.wardId)
        });
        queryClient.invalidateQueries({
          queryKey: wardKeys.detail(variables.wardId)
        });
      }
    },
  });
}

// =============================================================================
// BED AMENITIES HOOKS
// =============================================================================

/**
 * Get all bed amenities with optional filtering
 * @param {Object} filters - Query parameters for filtering
 * @param {Object} options - Additional query options
 * @returns {Object} Query result
 */
export function useAmenities(filters = {}, options = {}) {
  return useQuery({
    queryKey: wardKeys.amenitiesList(filters),
    queryFn: () => wardsApi.getAmenities(filters),
    ...options,
  });
}

/**
 * Get a single amenity by ID
 * @param {string} id - Amenity ID
 * @param {Object} options - Additional query options
 * @returns {Object} Query result
 */
export function useAmenity(id, options = {}) {
  return useQuery({
    queryKey: wardKeys.amenity(id),
    queryFn: () => wardsApi.getAmenity(id),
    enabled: !!id,
    ...options,
  });
}

/**
 * Create a new bed amenity (admin only)
 * @returns {Object} Mutation result
 */
export function useCreateAmenity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => wardsApi.createAmenity(data),
    onSuccess: () => {
      // Invalidate amenities list
      queryClient.invalidateQueries({ queryKey: wardKeys.amenities() });
    },
  });
}

/**
 * Update an existing bed amenity (admin only)
 * @returns {Object} Mutation result
 */
export function useUpdateAmenity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => wardsApi.updateAmenity(id, data),
    onSuccess: (responseData, variables) => {
      // Update the cache for this specific amenity
      queryClient.invalidateQueries({
        queryKey: wardKeys.amenity(variables.id)
      });

      // Invalidate amenities list
      queryClient.invalidateQueries({
        queryKey: wardKeys.amenities()
      });
    },
  });
}

/**
 * Delete a bed amenity (admin only)
 * @returns {Object} Mutation result
 */
export function useDeleteAmenity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => wardsApi.deleteAmenity(id),
    onSuccess: (data, variables) => {
      // Invalidate the amenity detail query
      queryClient.invalidateQueries({
        queryKey: wardKeys.amenity(variables)
      });

      // Invalidate amenities list
      queryClient.invalidateQueries({
        queryKey: wardKeys.amenities()
      });
    },
  });
}

// =============================================================================
// AVAILABLE BEDS HOOKS
// =============================================================================

/**
 * Get available beds with advanced filtering
 * @param {Object} filters - Query parameters:
 *   - ward: Ward ID
 *   - section: Section ID
 *   - gender: Patient gender (M/F) for automatic compatibility filtering
 *   - accommodation_tier: Tier (open, semi_private, private, vip)
 *   - isolation_capable: Boolean for isolation capability
 *   - amenities: Comma-separated amenity codes
 * @param {Object} options - Additional query options
 * @returns {Object} Query result
 */
export function useAvailableBeds(filters = {}, options = {}) {
  return useQuery({
    queryKey: wardKeys.availableBeds(filters),
    queryFn: () => wardsApi.getAvailableBeds(filters),
    ...options,
  });
}

// =============================================================================
// WARD STAFF HOOKS
// =============================================================================

/**
 * Get staff assigned to a ward
 * @param {string} wardId - Ward ID
 * @param {string|null} category - Optional role category filter ('nursing', 'medical', 'allied')
 * @param {Object} options - Additional query options
 * @returns {Object} Query result with staff list containing id, full_name, role_name
 */
export function useWardStaff(wardId, category = null, options = {}) {
  return useQuery({
    queryKey: wardKeys.wardStaff(wardId, category),
    queryFn: () => {
      const params = category ? { category } : {};
      return wardsApi.getWardStaff(wardId, params);
    },
    enabled: !!wardId,
    placeholderData: [],
    ...options,
  });
}

/**
 * Get detailed staff assignments (for management UI)
 * @param {Object} filters - Query parameters (ward, practitioner, category, show_inactive)
 * @param {Object} options - Additional query options
 * @returns {Object} Query result with detailed assignment data
 */
export function useStaffAssignments(filters = {}, options = {}) {
  return useQuery({
    queryKey: wardKeys.staffAssignmentsList(filters),
    queryFn: () => wardsApi.getStaffAssignments(filters),
    ...options,
  });
}

/**
 * Get ward assignments for a specific practitioner
 * @param {string} practitionerId - Practitioner ID
 * @param {Object} options - Additional query options
 * @returns {Object} Query result with practitioner's ward assignments
 */
export function usePractitionerAssignments(practitionerId, options = {}) {
  return useQuery({
    queryKey: wardKeys.practitionerAssignments(practitionerId),
    queryFn: () => wardsApi.getStaffAssignmentsByPractitioner(practitionerId),
    enabled: !!practitionerId,
    placeholderData: [],
    ...options,
  });
}

/**
 * Get staff roles (for assignment forms)
 * @param {Object} filters - Query parameters (category, show_inactive)
 * @param {Object} options - Additional query options
 * @returns {Object} Query result with staff roles
 */
export function useStaffRoles(filters = {}, options = {}) {
  return useQuery({
    queryKey: wardKeys.staffRolesList(filters),
    queryFn: () => wardsApi.getStaffRoles(filters),
    ...options,
  });
}

/**
 * Create a new staff assignment
 * @returns {Object} Mutation result
 */
export function useCreateStaffAssignment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => wardsApi.createStaffAssignment(data),
    onSuccess: (responseData, variables) => {
      // Invalidate staff assignments list
      queryClient.invalidateQueries({ queryKey: wardKeys.staffAssignments() });

      // Invalidate ward staff (lightweight endpoint)
      if (variables.ward) {
        queryClient.invalidateQueries({
          queryKey: wardKeys.wardStaff(variables.ward, null)
        });
      }

      // Invalidate practitioner assignments
      if (variables.practitioner) {
        queryClient.invalidateQueries({
          queryKey: wardKeys.practitionerAssignments(variables.practitioner)
        });
      }
    },
  });
}

/**
 * Update an existing staff assignment
 * @returns {Object} Mutation result
 */
export function useUpdateStaffAssignment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => wardsApi.updateStaffAssignment(id, data),
    onSuccess: (responseData, variables) => {
      // Invalidate the specific assignment
      queryClient.invalidateQueries({
        queryKey: wardKeys.staffAssignment(variables.id)
      });

      // Invalidate staff assignments list
      queryClient.invalidateQueries({ queryKey: wardKeys.staffAssignments() });

      // Invalidate ward staff queries
      if (responseData?.ward) {
        queryClient.invalidateQueries({
          queryKey: wardKeys.wardStaff(responseData.ward, null)
        });
      }

      // Invalidate practitioner assignments
      if (responseData?.practitioner) {
        queryClient.invalidateQueries({
          queryKey: wardKeys.practitionerAssignments(responseData.practitioner)
        });
      }
    },
  });
}

/**
 * Delete a staff assignment
 * @returns {Object} Mutation result
 */
export function useDeleteStaffAssignment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => wardsApi.deleteStaffAssignment(id),
    onSuccess: () => {
      // Invalidate all staff assignment related queries
      queryClient.invalidateQueries({ queryKey: wardKeys.staffAssignments() });
      queryClient.invalidateQueries({ queryKey: wardKeys.staff() });
    },
  });
}
