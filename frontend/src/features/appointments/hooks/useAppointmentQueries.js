import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { appointmentsApi } from '@/features/appointments/api';
import { immutableMetadataQueryOptions } from '@/lib/react-query';
import { createKeyFactory } from '@/shared/lib/queryKeys';

// Query keys
const baseKeys = createKeyFactory('appointments');

export const appointmentKeys = {
  ...baseKeys,
  types: () => [...appointmentKeys.all, 'types'],
  type: (id) => [...appointmentKeys.types(), id],
  availableSlots: (params) => [...appointmentKeys.all, 'availableSlots', params],
  scheduleSlots: (scheduleId, params) => [...appointmentKeys.all, 'scheduleSlots', scheduleId, params],
  availabilityRules: () => [...appointmentKeys.all, 'availabilityRules'],
  availabilityRule: (id) => [...appointmentKeys.availabilityRules(), id],
  scheduleMappings: () => [...appointmentKeys.all, 'scheduleMappings'],
  blockedTimes: (params) => [...appointmentKeys.all, 'blockedTimes', params],
  upcoming: () => [...appointmentKeys.all, 'upcoming'],
};

/**
 * Get appointments list with optional filtering
 * @param {Object} filters - Query parameters for filtering
 * @returns {Object} Query result
 */
export function useAppointments(filters = {}, options = {}) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: appointmentKeys.list(filters),
    queryFn: ({ signal }) => appointmentsApi.getAppointments({ ...filters, signal }),
    enabled,
  });
}

/**
 * Get a single appointment by ID
 * @param {string} id - Appointment ID
 * @returns {Object} Query result
 */
export function useAppointment(id) {
  return useQuery({
    queryKey: appointmentKeys.detail(id),
    queryFn: ({ signal }) => appointmentsApi.getAppointment(id, { signal }),
    enabled: !!id, // Only run the query if we have an ID
  });
}

/**
 * Create a new appointment
 * @returns {Object} Mutation result
 */
export function useCreateAppointment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => appointmentsApi.createAppointment(data),
    onSuccess: () => {
      // Invalidate the appointments list query to refetch
      queryClient.invalidateQueries({ queryKey: appointmentKeys.lists() });
    },
  });
}

/**
 * Update an existing appointment
 * @returns {Object} Mutation result
 */
export function useUpdateAppointment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => appointmentsApi.updateAppointment(id, data),

    // Optimistic update - immediately update UI before server responds
    onMutate: async ({ id, data }) => {
      // Cancel any outgoing refetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: appointmentKeys.detail(id) });

      // Snapshot the previous value
      const previousAppointment = queryClient.getQueryData(appointmentKeys.detail(id));

      // Optimistically update to the new value
      queryClient.setQueryData(appointmentKeys.detail(id), (old) => ({
        ...old,
        ...data,
      }));

      // Return context with the previous value for potential rollback
      return { previousAppointment, id };
    },

    // If mutation fails, rollback to the previous value
    onError: (err, variables, context) => {
      if (context?.previousAppointment) {
        queryClient.setQueryData(
          appointmentKeys.detail(context.id),
          context.previousAppointment
        );
      }
    },

    // Always refetch after error or success to ensure consistency
    onSettled: (data, error, variables) => {
      queryClient.invalidateQueries({
        queryKey: appointmentKeys.detail(variables.id)
      });
      queryClient.invalidateQueries({
        queryKey: appointmentKeys.lists()
      });
    },
  });
}

/**
 * Delete an appointment
 * @returns {Object} Mutation result
 */
export function useDeleteAppointment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => appointmentsApi.deleteAppointment(id),
    onSuccess: (data, variables) => {
      // Invalidate the appointment detail query
      queryClient.invalidateQueries({
        queryKey: appointmentKeys.detail(variables)
      });
      // Also invalidate the list to reflect changes
      queryClient.invalidateQueries({
        queryKey: appointmentKeys.lists()
      });
    },
  });
}

/**
 * Check in a patient for an appointment
 * @returns {Object} Mutation result
 */
export function useCheckInAppointment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => appointmentsApi.checkInAppointment(id),
    onSuccess: (data, variables) => {
      // Update the cache for this specific appointment
      queryClient.invalidateQueries({
        queryKey: appointmentKeys.detail(variables)
      });
      // Also invalidate the list to reflect changes
      queryClient.invalidateQueries({
        queryKey: appointmentKeys.lists()
      });
    },
  });
}

/**
 * Cancel an appointment
 * @returns {Object} Mutation result
 */
export function useCancelAppointment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, reason }) => appointmentsApi.cancelAppointment(id, reason),
    onSuccess: (data, variables) => {
      // Update the cache for this specific appointment
      queryClient.invalidateQueries({
        queryKey: appointmentKeys.detail(variables.id)
      });
      // Also invalidate the list to reflect changes
      queryClient.invalidateQueries({
        queryKey: appointmentKeys.lists()
      });
    },
  });
}

/**
 * Update appointment status
 * @returns {Object} Mutation result
 */
export function useUpdateAppointmentStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, status }) => appointmentsApi.updateAppointmentStatus(id, status),
    onSuccess: (data, variables) => {
      // Update the cache for this specific appointment
      queryClient.invalidateQueries({
        queryKey: appointmentKeys.detail(variables.id)
      });
      // Also invalidate the list to reflect changes
      queryClient.invalidateQueries({
        queryKey: appointmentKeys.lists()
      });
    },
  });
}

/**
 * Get available slots for scheduling
 * @param {Object} params - Query parameters
 * @returns {Object} Query result
 */
export function useAvailableSlots(params = {}, options = {}) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: appointmentKeys.availableSlots(params),
    queryFn: ({ signal }) => appointmentsApi.getAvailableSlots({ ...params, signal }),
    enabled: enabled && Object.keys(params).length > 0, // Only run if we have parameters
    staleTime: 0, // Always fetch fresh data for just-in-time slots
  });
}

/**
 * Get blocked times
 * @param {Object} params - Query parameters
 * @returns {Object} Query result
 */
export function useBlockedTimes(params = {}, options = {}) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: appointmentKeys.blockedTimes(params),
    queryFn: ({ signal }) => appointmentsApi.getBlockedTimes({ ...params, signal }),
    enabled,
  });
}

/**
 * Create a new blocked time
 * @returns {Object} Mutation result
 */
export function useCreateBlockedTime() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => appointmentsApi.createBlockedTime(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: appointmentKeys.all });
    },
  });
}

/**
 * Bulk create blocked times
 * @returns {Object} Mutation result
 */
export function useBulkCreateBlockedTime() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => appointmentsApi.bulkCreateBlockedTime(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: appointmentKeys.all });
    },
  });
}

/**
 * Update a blocked time
 * @returns {Object} Mutation result
 */
export function useUpdateBlockedTime() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => appointmentsApi.updateBlockedTime(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: appointmentKeys.all });
    },
  });
}

/**
 * Delete a blocked time
 * @returns {Object} Mutation result
 */
export function useDeleteBlockedTime() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => appointmentsApi.deleteBlockedTime(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: appointmentKeys.all });
    },
  });
}

/**
 * Get appointment types
 * @returns {Object} Query result
 */
export function useAppointmentTypes() {
  return useQuery({
    queryKey: appointmentKeys.types(),
    queryFn: ({ signal }) => appointmentsApi.getAppointmentTypes({ signal }),
    ...immutableMetadataQueryOptions(),
  });
}

/**
 * Get a single appointment type by ID
 * @param {string} id - Appointment type ID
 * @returns {Object} Query result
 */
export function useAppointmentType(id) {
  return useQuery({
    queryKey: appointmentKeys.type(id),
    queryFn: ({ signal }) => appointmentsApi.getAppointmentType(id, { signal }),
    enabled: !!id,
    ...immutableMetadataQueryOptions(),
  });
}

/**
 * Get slots for a specific schedule
 * @param {string} scheduleId - Schedule ID
 * @param {Object} params - Additional query parameters
 * @returns {Object} Query result
 */
export function useScheduleSlots(scheduleId, params = {}) {
  return useQuery({
    queryKey: appointmentKeys.scheduleSlots(scheduleId, params),
    queryFn: ({ signal }) => appointmentsApi.getScheduleSlots(scheduleId, { ...params, signal }),
    enabled: !!scheduleId,
  });
}

/**
 * Get practitioner availability rules
 * @param {Object} params - Query parameters
 * @returns {Object} Query result
 */
export function useAvailabilityRules(params = {}, options = {}) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: [...appointmentKeys.availabilityRules(), params],
    queryFn: ({ signal }) => appointmentsApi.getAvailabilityRules({ ...params, signal }),
    enabled,
  });
}

/**
 * Get a single availability rule by ID
 * @param {string} id - Availability rule ID
 * @returns {Object} Query result
 */
export function useAvailabilityRule(id) {
  return useQuery({
    queryKey: appointmentKeys.availabilityRule(id),
    queryFn: ({ signal }) => appointmentsApi.getAvailabilityRule(id, { signal }),
    enabled: !!id,
  });
}

/**
 * Get schedule mappings
 * @param {Object} params - Query parameters
 * @returns {Object} Query result
 */
export function useScheduleMappings(params = {}) {
  return useQuery({
    queryKey: [...appointmentKeys.scheduleMappings(), params],
    queryFn: ({ signal }) => appointmentsApi.getScheduleMappings({ ...params, signal }),
  });
}

/**
 * Create a new appointment type
 * @returns {Object} Mutation result
 */
export function useCreateAppointmentType() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => appointmentsApi.createAppointmentType(data),
    onSuccess: () => {
      // Invalidate the appointment types list query to refetch
      queryClient.invalidateQueries({ queryKey: appointmentKeys.types() });
    },
  });
}

/**
 * Update an existing appointment type
 * @returns {Object} Mutation result
 */
export function useUpdateAppointmentType() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => appointmentsApi.updateAppointmentType(id, data),

    // Optimistic update - immediately update UI before server responds
    onMutate: async ({ id, data }) => {
      // Cancel any outgoing refetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: appointmentKeys.type(id) });

      // Snapshot the previous value
      const previousAppointmentType = queryClient.getQueryData(appointmentKeys.type(id));

      // Optimistically update to the new value
      queryClient.setQueryData(appointmentKeys.type(id), (old) => ({
        ...old,
        ...data,
      }));

      // Return context with the previous value for potential rollback
      return { previousAppointmentType, id };
    },

    // If mutation fails, rollback to the previous value
    onError: (err, variables, context) => {
      if (context?.previousAppointmentType) {
        queryClient.setQueryData(
          appointmentKeys.type(context.id),
          context.previousAppointmentType
        );
      }
    },

    // Always refetch after error or success to ensure consistency
    onSettled: (data, error, variables) => {
      queryClient.invalidateQueries({
        queryKey: appointmentKeys.type(variables.id)
      });
      queryClient.invalidateQueries({
        queryKey: appointmentKeys.types()
      });
    },
  });
}

/**
 * Delete an appointment type
 * @returns {Object} Mutation result
 */
export function useDeleteAppointmentType() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => appointmentsApi.deleteAppointmentType(id),
    onSuccess: (data, variables) => {
      // Invalidate the appointment type detail query
      queryClient.invalidateQueries({
        queryKey: appointmentKeys.type(variables)
      });
      // Also invalidate the list to reflect changes
      queryClient.invalidateQueries({
        queryKey: appointmentKeys.types()
      });
    },
  });
}

/**
 * Create a new availability rule
 * @returns {Object} Mutation result
 */
export function useCreateAvailabilityRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => appointmentsApi.createAvailabilityRule(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: appointmentKeys.availabilityRules() });
    },
  });
}

/**
 * Update an existing availability rule
 * @returns {Object} Mutation result
 */
export function useUpdateAvailabilityRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => appointmentsApi.updateAvailabilityRule(id, data),

    // Optimistic update - immediately update UI before server responds
    onMutate: async ({ id, data }) => {
      // Cancel any outgoing refetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: appointmentKeys.availabilityRule(id) });

      // Snapshot the previous value
      const previousAvailabilityRule = queryClient.getQueryData(appointmentKeys.availabilityRule(id));

      // Optimistically update to the new value
      queryClient.setQueryData(appointmentKeys.availabilityRule(id), (old) => ({
        ...old,
        ...data,
      }));

      // Return context with the previous value for potential rollback
      return { previousAvailabilityRule, id };
    },

    // If mutation fails, rollback to the previous value
    onError: (err, variables, context) => {
      if (context?.previousAvailabilityRule) {
        queryClient.setQueryData(
          appointmentKeys.availabilityRule(context.id),
          context.previousAvailabilityRule
        );
      }
    },

    // Always refetch after error or success to ensure consistency
    onSettled: (data, error, variables) => {
      queryClient.invalidateQueries({
        queryKey: appointmentKeys.availabilityRule(variables.id)
      });
      queryClient.invalidateQueries({
        queryKey: appointmentKeys.availabilityRules()
      });
    },
  });
}

/**
 * Delete an availability rule
 * @returns {Object} Mutation result
 */
export function useDeleteAvailabilityRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => appointmentsApi.deleteAvailabilityRule(id),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({
        queryKey: appointmentKeys.availabilityRule(variables)
      });
      queryClient.invalidateQueries({
        queryKey: appointmentKeys.availabilityRules()
      });
    },
  });
}
