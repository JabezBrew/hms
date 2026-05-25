import { apiClient, handleApiError } from '../api-client';
import { handleV2ApiError } from './v2/errors';
import { isRustV2ApiMode } from './v2/runtime';
import { v2Api, v2Request } from './v2/client';

const DEFAULT_APPOINTMENT_TYPES = [
  {
    id: 'general',
    name: 'General',
    code: 'general',
    duration_minutes: 30,
    is_active: true,
  },
];

const appointmentCursorCache = new Map();

function adaptV2AppointmentType(type) {
  if (!type) {
    return type;
  }
  return {
    id: type.id,
    name: type.name,
    code: type.code,
    duration_minutes: type.duration_minutes ?? type.default_duration_minutes ?? 30,
    default_duration_minutes: type.default_duration_minutes ?? type.duration_minutes ?? 30,
    is_active: Boolean(type.is_active ?? true),
    created_at: type.created_at,
  };
}

function rethrowAbortError(error) {
  if (error?.name === 'AbortError') {
    throw error;
  }
}

function hashForCache(value) {
  let hash = 0;
  const input = JSON.stringify(value);
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) - hash) + input.charCodeAt(index);
    hash |= 0;
  }
  return String(hash);
}

function cursorCacheKey(params = {}) {
  const scope = { ...(params || {}) };
  delete scope.page;
  delete scope.cursor;
  delete scope.next_cursor;
  delete scope.signal;
  return hashForCache(scope);
}

function cacheCursorForNextPage(params, response) {
  const currentPage = Number(params?.page || 1);
  const nextCursor = response?.page?.next_cursor;
  if (!nextCursor) {
    return;
  }
  appointmentCursorCache.set(`${cursorCacheKey(params)}:${currentPage + 1}`, nextCursor);
}

function getCursorForParams(params = {}) {
  if (params.cursor || params.next_cursor) {
    return params.cursor || params.next_cursor;
  }
  const page = Number(params.page || 1);
  if (page <= 1) {
    return undefined;
  }
  return appointmentCursorCache.get(`${cursorCacheKey(params)}:${page}`);
}

function normalizeV2Limit(params = {}, fallback = 25) {
  const rawLimit = params.limit || params.page_size || fallback;
  const parsed = Number.parseInt(String(rawLimit), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, 100);
}

function queryParamsWithoutSignal(params = {}) {
  const queryParams = { ...(params || {}) };
  delete queryParams.signal;
  return queryParams;
}

function splitDisplayName(displayName) {
  const parts = String(displayName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return ['', ''];
  }
  if (parts.length === 1) {
    return [parts[0], ''];
  }
  return [parts[0], parts.slice(1).join(' ')];
}

function mapV2AppointmentStatus(status) {
  switch (status) {
    case 'scheduled':
      return 'booked';
    case 'checked_in':
      return 'arrived';
    case 'completed':
      return 'fulfilled';
    case 'cancelled':
      return 'cancelled';
    default:
      return status || 'pending';
  }
}

function normalizeV2AppointmentPayload(data = {}) {
  const patientId = data.patient_id || data.patient;
  const startsAt = data.starts_at || data.start_time || data.start;
  const endsAt = data.ends_at || data.end_time || data.end;
  const payload = {
    patient_id: patientId,
    starts_at: startsAt,
    ends_at: endsAt,
  };
  const optionalFields = {
    clinic_id: data.clinic_id || data.clinic,
    clinic_session_id: data.clinic_session_id || data.clinic_session || data.session_id,
    appointment_type_id: data.appointment_type_id || data.appointment_type,
    practitioner_user_id: data.practitioner_user_id || data.practitioner,
    overbook_reason: data.overbook_reason,
  };
  for (const [key, value] of Object.entries(optionalFields)) {
    if (value !== undefined && value !== null && value !== '') {
      payload[key] = value;
    }
  }
  return payload;
}

function normalizeV2SchedulingBookingPayload(data = {}) {
  const payload = normalizeV2AppointmentPayload(data);
  const sessionId = data.session_id || data.clinic_session_id || data.clinic_session;
  const serviceId = data.service_id || data.appointment_type_id || data.appointment_type;
  if (sessionId) {
    payload.session_id = sessionId;
    delete payload.clinic_session_id;
  }
  if (serviceId) {
    payload.service_id = serviceId;
    delete payload.appointment_type_id;
  }
  if (data.manual_booking_reason) {
    payload.manual_booking_reason = data.manual_booking_reason;
  }
  return payload;
}

function adaptV2Appointment(appointment) {
  if (!appointment) {
    return appointment;
  }

  const [firstName, lastName] = splitDisplayName(appointment.patient_display_name);

  return {
    id: appointment.id,
    patient: appointment.patient_id,
    patient_id: appointment.patient_id,
    ...(appointment.clinic_id ? { clinic_id: appointment.clinic_id } : {}),
    ...(appointment.clinic_session_id ? { clinic_session_id: appointment.clinic_session_id } : {}),
    ...(appointment.appointment_type_id ? { appointment_type_id: appointment.appointment_type_id } : {}),
    ...(appointment.practitioner_user_id
      ? {
          practitioner: appointment.practitioner_user_id,
          practitioner_user_id: appointment.practitioner_user_id,
        }
      : {}),
    patient_name: appointment.patient_display_name,
    patient_identifier: appointment.patient_code,
    patient_mrn: appointment.patient_code,
    patient_details: {
      id: appointment.patient_id,
      user_details: {
        first_name: firstName,
        last_name: lastName,
      },
    },
    start: appointment.starts_at,
    end: appointment.ends_at,
    start_time: appointment.starts_at,
    end_time: appointment.ends_at,
    status: mapV2AppointmentStatus(appointment.status),
    v2_status: appointment.status,
    appointment_type_name: appointment.appointment_type_name || 'General',
    appointment_type_details: appointment.appointment_type_id
      ? {
          id: appointment.appointment_type_id,
          name: appointment.appointment_type_name || 'Appointment',
          code: appointment.appointment_type_id,
          duration_minutes: 30,
          is_active: true,
        }
      : DEFAULT_APPOINTMENT_TYPES[0],
    comment: '',
    description: '',
    ...(appointment.cancellation_reason
      ? { cancellation_reason: appointment.cancellation_reason }
      : {}),
    ...(appointment.overbook_reason ? { overbook_reason: appointment.overbook_reason } : {}),
    ...(appointment.series_id ? { series_id: appointment.series_id } : {}),
    created_at: appointment.created_at,
  };
}

function adaptV2AppointmentListResponse(response, params = {}) {
  const limit = Number(response?.page?.limit || params.page_size || params.limit || 25);
  const currentPage = Number(params.page || 1);
  const results = Array.isArray(response?.data)
    ? response.data.map(adaptV2Appointment)
    : [];
  const hasNext = Boolean(response?.page?.has_next && response?.page?.next_cursor);
  const estimatedTotal = ((currentPage - 1) * limit) + results.length + (hasNext ? 1 : 0);

  cacheCursorForNextPage(params, response);

  return {
    results,
    page: currentPage,
    page_size: limit,
    count: estimatedTotal,
    total: estimatedTotal,
    count_exact: false,
    next: hasNext ? response.page.next_cursor : null,
    previous: currentPage > 1 ? String(currentPage - 1) : null,
    next_cursor: response?.page?.next_cursor || null,
  };
}

function adaptV2VisitCheckIn(visit) {
  if (!visit) {
    return visit;
  }

  const [firstName, lastName] = splitDisplayName(visit.patient_display_name);

  return {
    id: visit.id,
    visit_id: visit.id,
    encounter_id: visit.id,
    patient: visit.patient_id,
    patient_id: visit.patient_id,
    patient_name: visit.patient_display_name,
    patient_identifier: visit.patient_code,
    patient_mrn: visit.patient_code,
    patient_details: {
      id: visit.patient_id,
      user_details: {
        first_name: firstName,
        last_name: lastName,
      },
    },
    appointment: visit.appointment_id || null,
    appointment_id: visit.appointment_id || null,
    clinic_id: visit.clinic_id || null,
    visit_status: visit.status,
    v2_status: visit.status,
    checked_in_at: visit.checked_in_at,
  };
}

function getV2AppointmentListQuery(params = {}) {
  const query = {
    limit: normalizeV2Limit(params),
  };
  const date = params.date || params.start_date;
  if (date) {
    query.date = String(date).slice(0, 10);
  }
  const clinicId = params.clinic_id || params.clinic;
  if (clinicId) {
    query.clinic_id = clinicId;
  }
  const cursor = getCursorForParams(params);
  if (cursor) {
    query.cursor = cursor;
  }
  return query;
}

function getV2AvailabilityQuery(params = {}) {
  const startDate = params.start_date || params.date;
  if (!startDate) {
    throw new Error('Start date is required to load Rust V2 scheduling availability.');
  }
  const query = {
    start_date: String(startDate).slice(0, 10),
    limit: normalizeV2Limit(params, 100),
  };
  const endDate = params.end_date;
  if (endDate) {
    query.end_date = String(endDate).slice(0, 10);
  }
  const clinicId = params.clinic_id || params.clinic;
  if (clinicId) {
    query.clinic_id = clinicId;
  }
  const serviceId = params.service_id || params.appointment_type_id || params.appointment_type;
  if (serviceId) {
    query.service_id = serviceId;
  }
  const practitionerUserId = params.practitioner_user_id || params.practitioner_id || params.practitioner;
  if (practitionerUserId) {
    query.practitioner_user_id = practitionerUserId;
  }
  return query;
}

function unsupportedInRustV2(message) {
  return new Error(message);
}

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
      if (isRustV2ApiMode()) {
        const response = await v2Api.getAppointments({
          query: getV2AppointmentListQuery(params),
          signal: params.signal,
        });
        return adaptV2AppointmentListResponse(response, params);
      }

      const queryString = new URLSearchParams(queryParamsWithoutSignal(params)).toString();
      const endpoint = `/appointments/appointments/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch appointments'));
      }
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
      if (isRustV2ApiMode()) {
        return [];
      }

      const queryString = new URLSearchParams(queryParamsWithoutSignal(params)).toString();
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
      if (isRustV2ApiMode()) {
        throw unsupportedInRustV2('Rust V2 does not expose schedule mapping cancellation yet.');
      }

      return await apiClient.post(`/appointments/schedule-mappings/${id}/cancel/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw error;
      }
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
      if (isRustV2ApiMode()) {
        return [];
      }

      const queryParams = queryParamsWithoutSignal({ schedule_id: scheduleId, ...params });
      const queryString = new URLSearchParams(queryParams).toString();
      return await apiClient.get(`/appointments/slots/?${queryString}`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw error;
      }
      throw new Error(handleApiError(error, 'Failed to fetch schedule slots'));
    }
  },

  /**
   * Get a single appointment by ID
   * @param {string} id - Appointment ID
   * @returns {Promise<Object>} Appointment data
   */
  getAppointment: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getAppointmentById({ id }, { signal: options.signal });
        return adaptV2Appointment(response?.data);
      }

      return await apiClient.get(`/appointments/appointments/${id}/`);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch appointment'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch appointment'));
    }
  },

  /**
   * Create a new appointment
   * @param {Object} data - Appointment data
   * @returns {Promise<Object>} Created appointment data
   */
  createAppointment: async (data, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Request(
          {
            method: 'POST',
            path: '/api/v2/scheduling/appointments/book',
            body: normalizeV2SchedulingBookingPayload(data),
            signal: options.signal || data?.signal,
          },
        );
        return adaptV2Appointment(response?.data?.appointment);
      }

      return await apiClient.post('/appointments/appointments/', data);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to create appointment'));
      }
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
   * Create a new appointment using the legacy direct appointment contract.
   * @param {Object} data - Appointment data
   * @returns {Promise<Object>} Created appointment data
   */
  createDirectAppointment: async (data, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postAppointments(
          normalizeV2AppointmentPayload(data),
          { signal: options.signal || data?.signal },
        );
        return adaptV2Appointment(response?.data);
      }

      return await apiClient.post('/appointments/appointments/', data);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to create appointment'));
      }
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
  updateAppointment: async (id, data, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.patchAppointmentById(
          { id },
          normalizeV2AppointmentPayload(data),
          { signal: options.signal || data?.signal },
        );
        return adaptV2Appointment(response?.data);
      }

      return await apiClient.patch(`/appointments/appointments/${id}/`, data);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to update appointment'));
      }
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
      if (isRustV2ApiMode()) {
        throw unsupportedInRustV2('Rust V2 does not expose appointment deletion. Cancel the appointment instead.');
      }

      return await apiClient.delete(`/appointments/appointments/${id}/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw error;
      }
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
      if (isRustV2ApiMode()) {
        const response = await v2Request({
          method: 'GET',
          path: '/api/v2/scheduling/availability',
          query: getV2AvailabilityQuery(params),
          signal: params.signal,
        });
        return response?.data?.slots || [];
      }

      const queryString = new URLSearchParams(queryParamsWithoutSignal(params)).toString();
      return await apiClient.get(`/appointments/appointments/available_slots/?${queryString}`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw error;
      }
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
      if (isRustV2ApiMode()) {
        return [];
      }

      const queryString = new URLSearchParams(queryParamsWithoutSignal(params)).toString();
      return await apiClient.get(`/appointments/blocked-times/?${queryString}`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw error;
      }
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
      if (isRustV2ApiMode()) {
        throw unsupportedInRustV2('Rust V2 does not expose practitioner blocked time management yet.');
      }

      return await apiClient.post('/appointments/blocked-times/', data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw error;
      }
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
      if (isRustV2ApiMode()) {
        throw unsupportedInRustV2('Rust V2 does not expose practitioner blocked time management yet.');
      }

      return await apiClient.post('/appointments/blocked-times/bulk_create/', data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw error;
      }
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
      if (isRustV2ApiMode()) {
        throw unsupportedInRustV2('Rust V2 does not expose practitioner blocked time management yet.');
      }

      return await apiClient.patch(`/appointments/blocked-times/${id}/`, data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw error;
      }
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
      if (isRustV2ApiMode()) {
        throw unsupportedInRustV2('Rust V2 does not expose practitioner blocked time management yet.');
      }

      return await apiClient.delete(`/appointments/blocked-times/${id}/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw error;
      }
      throw new Error(handleApiError(error, 'Failed to delete blocked time'));
    }
  },

  /**
   * Check in a patient for an appointment
   * @param {string} id - Appointment ID
   * @returns {Promise<Object>} Updated appointment data
   */
  checkInAppointment: async (id, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const appointmentResponse = await v2Api.getAppointmentById(
          { id },
          { signal: options.signal },
        );
        const appointment = appointmentResponse?.data;
        const response = await v2Api.postVisitCheckIn(
          {
            patient_id: appointment?.patient_id,
            appointment_id: id,
            clinic_id: null,
          },
          { signal: options.signal },
        );
        return adaptV2VisitCheckIn(response?.data);
      }

      return await apiClient.post(`/appointments/appointments/${id}/start_visit/`);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to check in appointment'));
      }
      throw new Error(handleApiError(error, 'Failed to check in appointment'));
    }
  },

  /**
   * Cancel an appointment
   * @param {string} id - Appointment ID
   * @param {string} reason - Cancellation reason
   * @returns {Promise<Object>} Updated appointment data
   */
  cancelAppointment: async (id, reason, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const normalizedReason = String(reason || '').trim();
        if (!normalizedReason) {
          throw unsupportedInRustV2('Cancellation reason is required.');
        }
        const response = await v2Request({
          method: 'POST',
          path: '/api/v2/appointments/{id}/cancel',
          pathParams: { id },
          body: { reason: normalizedReason },
          signal: options.signal,
        });
        return adaptV2Appointment(response?.data);
      }

      return await apiClient.post(`/appointments/appointments/${id}/cancel/`, { reason });
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to cancel appointment'));
      }
      throw new Error(handleApiError(error, 'Failed to cancel appointment'));
    }
  },

  /**
   * Update appointment status
   * @param {string} id - Appointment ID
   * @param {string} status - New status (proposed, pending, booked, arrived, fulfilled, cancelled, noshow)
   * @returns {Promise<Object>} Updated appointment data
   */
  updateAppointmentStatus: async (id, status, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        if (status === 'cancelled') {
          return appointmentsApi.cancelAppointment(id, undefined, options);
        }
        if (status === 'arrived' || status === 'checked_in') {
          return appointmentsApi.checkInAppointment(id, options);
        }
        throw unsupportedInRustV2('Rust V2 only supports appointment cancellation as a direct status transition.');
      }

      return await apiClient.patch(`/appointments/appointments/${id}/`, { status });
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw error;
      }
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
      if (isRustV2ApiMode()) {
        return [];
      }

      const queryString = new URLSearchParams(queryParamsWithoutSignal(params)).toString();
      const endpoint = `/appointments/availability-rules/${queryString ? `?${queryString}` : ''}`;
      return await apiClient.get(endpoint);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw error;
      }
      throw new Error(handleApiError(error, 'Failed to fetch availability rules'));
    }
  },

  /**
   * Get a single availability rule by ID
   * @param {string} id - Availability rule ID
   * @returns {Promise<Object>} Availability rule data
   */
  getAvailabilityRule: async (id, _options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        return null;
      }

      return await apiClient.get(`/appointments/availability-rules/${id}/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw error;
      }
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
      if (isRustV2ApiMode()) {
        throw unsupportedInRustV2('Rust V2 does not expose practitioner availability rule management yet.');
      }

      return await apiClient.post('/appointments/availability-rules/', data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw error;
      }
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
      if (isRustV2ApiMode()) {
        throw unsupportedInRustV2('Rust V2 does not expose practitioner availability rule management yet.');
      }

      return await apiClient.patch(`/appointments/availability-rules/${id}/`, data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw error;
      }
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
      if (isRustV2ApiMode()) {
        throw unsupportedInRustV2('Rust V2 does not expose practitioner availability rule management yet.');
      }

      return await apiClient.delete(`/appointments/availability-rules/${id}/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw error;
      }
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
      if (isRustV2ApiMode()) {
        return { slots: [] };
      }

      return await apiClient.post('/appointments/availability-rules/preview_slots/', data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw error;
      }
      throw new Error(handleApiError(error, 'Failed to preview slots'));
    }
  },

  /**
   * Get all appointment types
   * @returns {Promise<Array>} List of appointment types
   */
  getAppointmentTypes: async (_options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getAppointmentTypes({ query: { limit: 100 } });
        return (response?.data || []).map(adaptV2AppointmentType);
      }

      return await apiClient.get('/appointments/types/');
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw error;
      }
      throw new Error(handleApiError(error, 'Failed to fetch appointment types'));
    }
  },

  /**
   * Get a single appointment type by ID
   * @param {string} id - Appointment type ID
   * @returns {Promise<Object>} Appointment type data
   */
  getAppointmentType: async (id, _options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getAppointmentTypes({ query: { limit: 100 } });
        return (response?.data || []).map(adaptV2AppointmentType).find((type) => type.id === id) || null;
      }

      return await apiClient.get(`/appointments/types/${id}/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw error;
      }
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
      if (isRustV2ApiMode()) {
        throw unsupportedInRustV2('Rust V2 does not expose appointment type management yet.');
      }

      return await apiClient.post('/appointments/types/', data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw error;
      }
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
      if (isRustV2ApiMode()) {
        throw unsupportedInRustV2('Rust V2 does not expose appointment type management yet.');
      }

      return await apiClient.patch(`/appointments/types/${id}/`, data);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw error;
      }
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
      if (isRustV2ApiMode()) {
        throw unsupportedInRustV2('Rust V2 does not expose appointment type management yet.');
      }

      return await apiClient.delete(`/appointments/types/${id}/`);
    } catch (error) {
      if (isRustV2ApiMode()) {
        throw error;
      }
      throw new Error(handleApiError(error, 'Failed to delete appointment type'));
    }
  },
};
