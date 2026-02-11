import { apiClient, handleApiError } from '../api-client';

/**
 * Appointments API service
 */
export const appointmentsApi = {
  /**
   * Get all appointments with optional filtering
   * @param {Object} params - Query parameters for filtering
   * @returns {Promise<Array>} List of appointments
   */
  getAppointments: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/appointments/appointments/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch appointments'));
    }
  },

  /**
   * Get all schedule mappings
   * @param {Object} params - Query parameters for filtering
   * @returns {Promise<Array>} List of schedule mappings
   */
  getScheduleMappings: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/appointments/schedule-mappings/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch schedule mappings'));
    }
  },

  /**
   * Cancel a schedule mapping
   * @param {string} id - Schedule mapping ID
   * @returns {Promise<Object>} Result of cancellation
   */
  cancelScheduleMapping: async (id) => {
    try {
      return await apiClient.post(`/appointments/schedule-mappings/${id}/cancel/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to cancel schedule'));
    }
  },

  /**
   * Get all schedule templates
   * @param {Object} params - Query parameters for filtering
   * @returns {Promise<Array>} List of schedule templates
   */
  getScheduleTemplates: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/appointments/templates/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch schedule templates'));
    }
  },

  /**
   * Get a single schedule template by ID
   * @param {string} id - Schedule template ID
   * @returns {Promise<Object>} Schedule template data
   */
  getScheduleTemplate: async (id) => {
    try {
      return await apiClient.get(`/appointments/templates/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch schedule template'));
    }
  },

  /**
   * Create a new schedule template
   * @param {Object} data - Schedule template data
   * @returns {Promise<Object>} Created schedule template data
   */
  createScheduleTemplate: async (data) => {
    try {
      return await apiClient.post('/appointments/templates/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create schedule template'));
    }
  },

  /**
   * Update a schedule template
   * @param {string} id - Schedule template ID
   * @param {Object} data - Schedule template data to update
   * @returns {Promise<Object>} Updated schedule template data
   */
  updateScheduleTemplate: async (id, data) => {
    try {
      return await apiClient.put(`/appointments/templates/${id}/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update schedule template'));
    }
  },

  /**
   * Delete a schedule template
   * @param {string} id - Schedule template ID
   * @returns {Promise<void>}
   */
  deleteScheduleTemplate: async (id) => {
    try {
      return await apiClient.delete(`/appointments/templates/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to delete schedule template'));
    }
  },

  /**
   * Generate a schedule from a template
   * @param {string} id - Schedule template ID
   * @param {Object} data - Data containing start_date and end_date
   * @returns {Promise<Object>} Generated schedule data
   */
  generateSchedule: async (id, data) => {
    try {
      return await apiClient.post(`/appointments/templates/${id}/generate_schedule/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to generate schedule'));
    }
  },

  /**
   * Get slots for a specific schedule
   * @param {string} scheduleId - Schedule ID
   * @param {Object} params - Additional query parameters
   * @returns {Promise<Array>} List of slots
   */
  getScheduleSlots: async (scheduleId, params = {}) => {
    try {
      const queryParams = { schedule_id: scheduleId, ...params };
      const queryString = new URLSearchParams(queryParams).toString();
      return await apiClient.get(`/appointments/slots/?${queryString}`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch schedule slots'));
    }
  },

  /**
   * Get all time slots for a schedule template
   * @param {string} templateId - Schedule template ID
   * @returns {Promise<Array>} List of time slots
   */
  getTimeSlots: async (templateId) => {
    try {
      return await apiClient.get(`/appointments/time-slots/?template=${templateId}`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch time slots'));
    }
  },

  /**
   * Create a new time slot
   * @param {Object} data - Time slot data
   * @returns {Promise<Object>} Created time slot data
   */
  createTimeSlot: async (data) => {
    try {
      return await apiClient.post('/appointments/time-slots/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create time slot'));
    }
  },

  /**
   * Update a time slot
   * @param {string} id - Time slot ID
   * @param {Object} data - Time slot data to update
   * @returns {Promise<Object>} Updated time slot data
   */
  updateTimeSlot: async (id, data) => {
    try {
      return await apiClient.put(`/appointments/time-slots/${id}/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update time slot'));
    }
  },

  /**
   * Delete a time slot
   * @param {string} id - Time slot ID
   * @returns {Promise<void>}
   */
  deleteTimeSlot: async (id) => {
    try {
      return await apiClient.delete(`/appointments/time-slots/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to delete time slot'));
    }
  },

  /**
   * Get a single appointment by ID
   * @param {string} id - Appointment ID
   * @returns {Promise<Object>} Appointment data
   */
  getAppointment: async (id) => {
    try {
      return await apiClient.get(`/appointments/appointments/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch appointment'));
    }
  },

  /**
   * Create a new appointment
   * @param {Object} data - Appointment data
   * @returns {Promise<Object>} Created appointment data
   */
  createAppointment: async (data) => {
    try {
      return await apiClient.post('/appointments/appointments/', data);
    } catch (error) {
      // Extract field-level validation errors for better user feedback
      if (error.data && typeof error.data === 'object') {
        const fieldErrors = [];
        const fieldNameMap = {
          'patient': 'Patient',
          'practitioner': 'Doctor',
          'appointment_type': 'Appointment type',
          'start_time': 'Start time',
          'end_time': 'End time',
          'slot': 'Time slot',
        };

        for (const [field, messages] of Object.entries(error.data)) {
          const fieldName = fieldNameMap[field] || field;
          const message = Array.isArray(messages) ? messages[0] : messages;
          fieldErrors.push(`${fieldName}: ${message}`);
        }

        if (fieldErrors.length > 0) {
          throw new Error(fieldErrors.join('\n'));
        }
      }
      throw new Error(handleApiError(error, 'Failed to create appointment'));
    }
  },

  /**
   * Update an appointment
   * @param {string} id - Appointment ID
   * @param {Object} data - Appointment data to update
   * @returns {Promise<Object>} Updated appointment data
   */
  updateAppointment: async (id, data) => {
    try {
      return await apiClient.put(`/appointments/appointments/${id}/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update appointment'));
    }
  },

  /**
   * Delete an appointment
   * @param {string} id - Appointment ID
   * @returns {Promise<void>}
   */
  deleteAppointment: async (id) => {
    try {
      return await apiClient.delete(`/appointments/appointments/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to delete appointment'));
    }
  },

  /**
   * Get available slots for scheduling
   * @param {Object} params - Query parameters including practitioner_id, start_date, end_date, status, etc.
   * @returns {Promise<Array>} List of available slots
   */
  getAvailableSlots: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      return await apiClient.get(`/appointments/appointments/available_slots/?${queryString}`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch available slots'));
    }
  },

  /**
   * Get blocked times
   * @param {Object} params - Query parameters (practitioner_id, start_date, end_date)
   * @returns {Promise<Array>} List of blocked times
   */
  getBlockedTimes: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      return await apiClient.get(`/appointments/blocked-times/?${queryString}`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch blocked times'));
    }
  },

  /**
   * Create a blocked time entry
   * @param {Object} data - Blocked time data
   * @returns {Promise<Object>} Created blocked time
   */
  createBlockedTime: async (data) => {
    try {
      return await apiClient.post('/appointments/blocked-times/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create blocked time'));
    }
  },

  /**
   * Bulk create blocked time entries (e.g. for date ranges)
   * @param {Object} data - Bulk creation data (practitioner_id, start_date, end_date, reason, is_all_day)
   * @returns {Promise<Object>} Result of bulk creation
   */
  bulkCreateBlockedTime: async (data) => {
    try {
      return await apiClient.post('/appointments/blocked-times/bulk_create/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to bulk create blocked times'));
    }
  },

  /**
   * Update a blocked time entry
   * @param {string} id - Blocked time ID
   * @param {Object} data - Updated data
   * @returns {Promise<Object>} Updated blocked time
   */
  updateBlockedTime: async (id, data) => {
    try {
      return await apiClient.put(`/appointments/blocked-times/${id}/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update blocked time'));
    }
  },

  /**
   * Delete a blocked time entry
   * @param {string} id - Blocked time ID
   * @returns {Promise<void>}
   */
  deleteBlockedTime: async (id) => {
    try {
      return await apiClient.delete(`/appointments/blocked-times/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to delete blocked time'));
    }
  },

  /**
   * Check in a patient for an appointment
   * @param {string} id - Appointment ID
   * @returns {Promise<Object>} Updated appointment data
   */
  checkInAppointment: async (id) => {
    try {
      return await apiClient.post(`/appointments/appointments/${id}/check-in/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to check in appointment'));
    }
  },

  /**
   * Cancel an appointment
   * @param {string} id - Appointment ID
   * @param {string} reason - Cancellation reason
   * @returns {Promise<Object>} Updated appointment data
   */
  cancelAppointment: async (id, reason) => {
    try {
      return await apiClient.post(`/appointments/appointments/${id}/cancel/`, { reason });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to cancel appointment'));
    }
  },

  /**
   * Update appointment status
   * @param {string} id - Appointment ID
   * @param {string} status - New status (proposed, pending, booked, arrived, fulfilled, cancelled, noshow)
   * @returns {Promise<Object>} Updated appointment data
   */
  updateAppointmentStatus: async (id, status) => {
    try {
      return await apiClient.patch(`/appointments/appointments/${id}/`, { status });
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update appointment status'));
    }
  },

  /**
   * Get all recurring schedules
   * @param {Object} params - Query parameters for filtering
   * @returns {Promise<Array>} List of recurring schedules
   */
  getRecurringSchedules: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/appointments/recurring-schedules/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch recurring schedules'));
    }
  },

  /**
   * Get a single recurring schedule by ID
   * @param {string} id - Recurring schedule ID
   * @returns {Promise<Object>} Recurring schedule data
   */
  getRecurringSchedule: async (id) => {
    try {
      return await apiClient.get(`/appointments/recurring-schedules/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch recurring schedule'));
    }
  },

  /**
   * Create a new recurring schedule
   * @param {Object} data - Recurring schedule data
   * @returns {Promise<Object>} Created recurring schedule data
   */
  createRecurringSchedule: async (data) => {
    try {
      return await apiClient.post('/appointments/recurring-schedules/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create recurring schedule'));
    }
  },

  /**
   * Update a recurring schedule
   * @param {string} id - Recurring schedule ID
   * @param {Object} data - Recurring schedule data to update
   * @returns {Promise<Object>} Updated recurring schedule data
   */
  updateRecurringSchedule: async (id, data) => {
    try {
      return await apiClient.put(`/appointments/recurring-schedules/${id}/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update recurring schedule'));
    }
  },

  /**
   * Delete a recurring schedule
   * @param {string} id - Recurring schedule ID
   * @returns {Promise<void>}
   */
  deleteRecurringSchedule: async (id) => {
    try {
      return await apiClient.delete(`/appointments/recurring-schedules/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to delete recurring schedule'));
    }
  },

  /**
   * Preview slots for a recurring schedule configuration
   * @param {Object} data - Configuration data (start_time, end_time, slot_duration, breaks)
   * @returns {Promise<Object>} Preview result with slots
   */
  previewSlots: async (data) => {
    try {
      return await apiClient.post('/appointments/recurring-schedules/preview_slots/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to preview slots'));
    }
  },

  /**
   * @deprecated This method is deprecated. Use just-in-time computation via getAvailableSlots instead.
   * Batch generate slots for all practitioners with active recurring schedules
   * @param {Object} params - Parameters including days (number of days to generate)
   * @returns {Promise<Object>} Result of batch generation
   */
  batchGenerateSlots: async (params = {}) => {
    console.warn('batchGenerateSlots is deprecated. Use getAvailableSlots for just-in-time computation.');
    try {
      return await apiClient.post('/appointments/batch-generate-slots/generate_slots/', params);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to batch generate slots'));
    }
  },

  /**
   * Get all appointment types
   * @returns {Promise<Array>} List of appointment types
   */
  getAppointmentTypes: async () => {
    try {
      return await apiClient.get('/appointments/types/');
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch appointment types'));
    }
  },

  /**
   * Get a single appointment type by ID
   * @param {string} id - Appointment type ID
   * @returns {Promise<Object>} Appointment type data
   */
  getAppointmentType: async (id) => {
    try {
      return await apiClient.get(`/appointments/types/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch appointment type'));
    }
  },

  /**
   * Create a new appointment type
   * @param {Object} data - Appointment type data
   * @returns {Promise<Object>} Created appointment type data
   */
  createAppointmentType: async (data) => {
    try {
      return await apiClient.post('/appointments/types/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create appointment type'));
    }
  },

  /**
   * Update an appointment type
   * @param {string} id - Appointment type ID
   * @param {Object} data - Appointment type data to update
   * @returns {Promise<Object>} Updated appointment type data
   */
  updateAppointmentType: async (id, data) => {
    try {
      return await apiClient.put(`/appointments/types/${id}/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update appointment type'));
    }
  },

  /**
   * Delete an appointment type
   * @param {string} id - Appointment type ID
   * @returns {Promise<void>}
   */
  deleteAppointmentType: async (id) => {
    try {
      return await apiClient.delete(`/appointments/types/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to delete appointment type'));
    }
  },
};
