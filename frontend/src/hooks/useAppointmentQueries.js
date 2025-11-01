import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { appointmentsApi } from '@/lib/api/appointments';

// Query keys
export const appointmentKeys = {
  all: ['appointments'],
  lists: () => [...appointmentKeys.all, 'list'],
  list: (filters) => [...appointmentKeys.lists(), { filters }],
  details: () => [...appointmentKeys.all, 'detail'],
  detail: (id) => [...appointmentKeys.details(), id],
  types: () => [...appointmentKeys.all, 'types'],
  type: (id) => [...appointmentKeys.types(), id],
  availableSlots: (params) => [...appointmentKeys.all, 'availableSlots', params],
  scheduleTemplates: () => [...appointmentKeys.all, 'scheduleTemplates'],
  scheduleTemplate: (id) => [...appointmentKeys.scheduleTemplates(), id],
  timeSlots: (templateId) => [...appointmentKeys.all, 'timeSlots', templateId],
  scheduleSlots: (scheduleId, params) => [...appointmentKeys.all, 'scheduleSlots', scheduleId, params],
  recurringSchedules: () => [...appointmentKeys.all, 'recurringSchedules'],
  recurringSchedule: (id) => [...appointmentKeys.recurringSchedules(), id],
  scheduleMappings: () => [...appointmentKeys.all, 'scheduleMappings'],
};

/**
 * Get appointments list with optional filtering
 * @param {Object} filters - Query parameters for filtering
 * @returns {Object} Query result
 */
export function useAppointments(filters = {}) {
  return useQuery({
    queryKey: appointmentKeys.list(filters),
    queryFn: () => appointmentsApi.getAppointments(filters),
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
export function useAvailableSlots(params = {}) {
  return useQuery({
    queryKey: appointmentKeys.availableSlots(params),
    queryFn: () => appointmentsApi.getAvailableSlots(params),
    enabled: Object.keys(params).length > 0, // Only run if we have parameters
    staleTime: 5 * 60 * 1000, // 5 minutes - slots can change frequently
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
    staleTime: 24 * 60 * 60 * 1000, // 24 hours - types rarely change
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
    staleTime: 24 * 60 * 60 * 1000, // 24 hours - types rarely change
  });
}

/**
 * Get schedule templates
 * @param {Object} params - Query parameters
 * @returns {Object} Query result
 */
export function useScheduleTemplates(params = {}) {
  return useQuery({
    queryKey: [...appointmentKeys.scheduleTemplates(), params],
    queryFn: () => appointmentsApi.getScheduleTemplates(params),
  });
}

/**
 * Get a single schedule template by ID
 * @param {string} id - Schedule template ID
 * @returns {Object} Query result
 */
export function useScheduleTemplate(id) {
  return useQuery({
    queryKey: appointmentKeys.scheduleTemplate(id),
    queryFn: () => appointmentsApi.getScheduleTemplate(id),
    enabled: !!id,
  });
}

/**
 * Get time slots for a schedule template
 * @param {string} templateId - Schedule template ID
 * @returns {Object} Query result
 */
export function useTimeSlots(templateId) {
  return useQuery({
    queryKey: appointmentKeys.timeSlots(templateId),
    queryFn: () => appointmentsApi.getTimeSlots(templateId),
    enabled: !!templateId,
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
export function useRecurringSchedules(params = {}) {
  return useQuery({
    queryKey: [...appointmentKeys.recurringSchedules(), params],
    queryFn: () => appointmentsApi.getRecurringSchedules(params),
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
 * Create a new time slot
 * @returns {Object} Mutation result
 */
export function useCreateTimeSlot() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => appointmentsApi.createTimeSlot(data),
    onSuccess: (data) => {
      // Invalidate the time slots query for the template
      if (data && data.template) {
        queryClient.invalidateQueries({ 
          queryKey: appointmentKeys.timeSlots(data.template) 
        });
      }
    },
  });
}

/**
 * Update an existing time slot
 * @returns {Object} Mutation result
 */
export function useUpdateTimeSlot() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => appointmentsApi.updateTimeSlot(id, data),

    // Optimistic update - immediately update UI before server responds
    onMutate: async ({ id, data }) => {
      // We need the template ID to update the cache
      const templateId = data.template;
      if (!templateId) return;

      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: appointmentKeys.timeSlots(templateId) });

      // Snapshot the previous value
      const previousTimeSlots = queryClient.getQueryData(appointmentKeys.timeSlots(templateId));

      // Optimistically update to the new value
      queryClient.setQueryData(appointmentKeys.timeSlots(templateId), (old) => {
        if (!Array.isArray(old)) return old;
        return old.map(slot => slot.id === id ? { ...slot, ...data } : slot);
      });

      // Return context with the previous value for potential rollback
      return { previousTimeSlots, templateId };
    },

    // If mutation fails, rollback to the previous value
    onError: (err, variables, context) => {
      if (context?.previousTimeSlots && context?.templateId) {
        queryClient.setQueryData(
          appointmentKeys.timeSlots(context.templateId),
          context.previousTimeSlots
        );
      }
    },

    // Always refetch after error or success to ensure consistency
    onSettled: (data) => {
      if (data && data.template) {
        queryClient.invalidateQueries({
          queryKey: appointmentKeys.timeSlots(data.template)
        });
      }
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
