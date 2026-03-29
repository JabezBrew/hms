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
  recurringSchedules: () => [...appointmentKeys.all, 'recurringSchedules'],
  recurringSchedule: (id) => [...appointmentKeys.recurringSchedules(), id],
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
    queryFn: () => appointmentsApi.getAppointments(filters),
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
    queryFn: () => appointmentsApi.getAppointment(id),
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
    queryFn: () => appointmentsApi.getAvailableSlots(params),
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
    queryFn: () => appointmentsApi.getBlockedTimes(params),
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
    queryFn: () => appointmentsApi.getAppointmentTypes(),
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
    queryFn: () => appointmentsApi.getAppointmentType(id),
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
    queryFn: () => appointmentsApi.getScheduleSlots(scheduleId, params),
    enabled: !!scheduleId,
  });
}

/**
 * Get recurring schedules
 * @param {Object} params - Query parameters
 * @returns {Object} Query result
 */
export function useRecurringSchedules(params = {}, options = {}) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: [...appointmentKeys.recurringSchedules(), params],
    queryFn: () => appointmentsApi.getRecurringSchedules(params),
    enabled,
  });
}

/**
 * Get a single recurring schedule by ID
 * @param {string} id - Recurring schedule ID
 * @returns {Object} Query result
 */
export function useRecurringSchedule(id) {
  return useQuery({
    queryKey: appointmentKeys.recurringSchedule(id),
    queryFn: () => appointmentsApi.getRecurringSchedule(id),
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
    queryFn: () => appointmentsApi.getScheduleMappings(params),
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
 * Create a new recurring schedule
 * @returns {Object} Mutation result
 */
export function useCreateRecurringSchedule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => appointmentsApi.createRecurringSchedule(data),
    onSuccess: () => {
      // Invalidate the recurring schedules list query to refetch
      queryClient.invalidateQueries({ queryKey: appointmentKeys.recurringSchedules() });
    },
  });
}

/**
 * Update an existing recurring schedule
 * @returns {Object} Mutation result
 */
export function useUpdateRecurringSchedule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => appointmentsApi.updateRecurringSchedule(id, data),

    // Optimistic update - immediately update UI before server responds
    onMutate: async ({ id, data }) => {
      // Cancel any outgoing refetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: appointmentKeys.recurringSchedule(id) });

      // Snapshot the previous value
      const previousRecurringSchedule = queryClient.getQueryData(appointmentKeys.recurringSchedule(id));

      // Optimistically update to the new value
      queryClient.setQueryData(appointmentKeys.recurringSchedule(id), (old) => ({
        ...old,
        ...data,
      }));

      // Return context with the previous value for potential rollback
      return { previousRecurringSchedule, id };
    },

    // If mutation fails, rollback to the previous value
    onError: (err, variables, context) => {
      if (context?.previousRecurringSchedule) {
        queryClient.setQueryData(
          appointmentKeys.recurringSchedule(context.id),
          context.previousRecurringSchedule
        );
      }
    },

    // Always refetch after error or success to ensure consistency
    onSettled: (data, error, variables) => {
      queryClient.invalidateQueries({
        queryKey: appointmentKeys.recurringSchedule(variables.id)
      });
      queryClient.invalidateQueries({
        queryKey: appointmentKeys.recurringSchedules()
      });
    },
  });
}

/**
 * Delete a recurring schedule
 * @returns {Object} Mutation result
 */
export function useDeleteRecurringSchedule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => appointmentsApi.deleteRecurringSchedule(id),
    onSuccess: (data, variables) => {
      // Invalidate the recurring schedule detail query
      queryClient.invalidateQueries({
        queryKey: appointmentKeys.recurringSchedule(variables)
      });
      // Also invalidate the list to reflect changes
      queryClient.invalidateQueries({
        queryKey: appointmentKeys.recurringSchedules()
      });
    },
  });
}
