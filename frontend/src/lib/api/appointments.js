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
      return await apiClient.patch(`/appointments/appointments/${id}/`, data);
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
      return await apiClient.patch(`/appointments/blocked-times/${id}/`, data);
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
      return await apiClient.post(`/appointments/appointments/${id}/start_visit/`);
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
   * Get all practitioner personal availability rules
   * @param {Object} params - Query parameters for filtering
   * @returns {Promise<Array>} List of availability rules
   */
  getAvailabilityRules: async (params = {}) => {
    try {
      const queryString = new URLSearchParams(params).toString();
      const endpoint = `/appointments/availability-rules/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch availability rules'));
    }
  },

  /**
   * Get a single availability rule by ID
   * @param {string} id - Availability rule ID
   * @returns {Promise<Object>} Availability rule data
   */
  getAvailabilityRule: async (id) => {
    try {
      return await apiClient.get(`/appointments/availability-rules/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch availability rule'));
    }
  },

  /**
   * Create a new availability rule
   * @param {Object} data - Availability rule data
   * @returns {Promise<Object>} Created availability rule data
   */
  createAvailabilityRule: async (data) => {
    try {
      return await apiClient.post('/appointments/availability-rules/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create availability rule'));
    }
  },

  /**
   * Update an availability rule
   * @param {string} id - Availability rule ID
   * @param {Object} data - Availability rule data to update
   * @returns {Promise<Object>} Updated availability rule data
   */
  updateAvailabilityRule: async (id, data) => {
    try {
      return await apiClient.patch(`/appointments/availability-rules/${id}/`, data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update availability rule'));
    }
  },

  /**
   * Delete an availability rule
   * @param {string} id - Availability rule ID
   * @returns {Promise<void>}
   */
  deleteAvailabilityRule: async (id) => {
    try {
      return await apiClient.delete(`/appointments/availability-rules/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to delete availability rule'));
    }
  },

  /**
   * Preview slots for an availability rule configuration
   * @param {Object} data - Configuration data (start_time, end_time, slot_duration, breaks)
   * @returns {Promise<Object>} Preview result with slots
   */
  previewSlots: async (data) => {
    try {
      return await apiClient.post('/appointments/availability-rules/preview_slots/', data);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to preview slots'));
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
      return await apiClient.patch(`/appointments/types/${id}/`, data);
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
