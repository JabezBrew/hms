import { apiClient, handleApiError } from '@/lib/api-client';
import { handleV2ApiError } from '@/lib/api/v2/errors';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { v2Api } from '@/lib/api/v2/client';

function rethrowAbortError(error) {
  if (error?.name === 'AbortError') {
    throw error;
  }
}

function queryWithoutSignal(params = {}) {
  const query = { ...(params || {}) };
  delete query.signal;
  return query;
}

function dataList(response) {
  return Array.isArray(response?.data) ? response.data : [];
}

function normalizeSessionPayload(data = {}) {
  const clinicId = data.clinic_id || data.clinic;
  const serviceId = data.service_id || data.appointment_type_id || data.appointment_type;
  const payload = {
    clinic_id: clinicId || null,
    owner_type: data.owner_type || (clinicId ? 'clinic' : 'facility'),
    owner_id: data.owner_id || clinicId || null,
    name: data.name,
    mode: data.mode || 'capacity_block',
    starts_at: data.starts_at,
    ends_at: data.ends_at,
    capacity: Number(data.capacity || 1),
    allow_overbooking: Boolean(data.allow_overbooking),
    overbook_limit: Number(data.overbook_limit || 0),
  };

  if (payload.mode === 'fixed_slot') {
    payload.slot_minutes = Number(data.slot_minutes || 30);
  }
  if (data.service_code) {
    payload.service_code = data.service_code;
  }
  if (data.practitioner_user_id || data.practitioner) {
    payload.practitioner_user_id = data.practitioner_user_id || data.practitioner;
  }
  if (serviceId) {
    payload.allowed_service_ids = [serviceId];
  }
  return payload;
}

export const schedulingApi = {
  listServices: async (params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getSchedulingServices({
          query: queryWithoutSignal(params),
          signal: options.signal || params.signal,
        });
        return dataList(response);
      }
      return await apiClient.get('/appointments/appointment-types/', {
        params: queryWithoutSignal(params),
        ...options,
      });
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to load bookable services'));
      }
      throw new Error(handleApiError(error, 'Failed to load appointment types'));
    }
  },

  listSessions: async (params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getSchedulingSessions({
          query: queryWithoutSignal(params),
          signal: options.signal || params.signal,
        });
        return dataList(response);
      }
      return [];
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to load bookable sessions'));
      }
      throw new Error(handleApiError(error, 'Failed to load schedule sessions'));
    }
  },

  listExceptions: async (params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getSchedulingExceptions({
          query: queryWithoutSignal(params),
          signal: options.signal || params.signal,
        });
        return dataList(response);
      }
      return [];
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to load scheduling exceptions'));
      }
      throw new Error(handleApiError(error, 'Failed to load blocked times'));
    }
  },

  createSession: async (data, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postSchedulingSessions(
          normalizeSessionPayload(data),
          options,
        );
        return response?.data;
      }
      throw new Error('Session management is only available on Rust V2.');
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to create bookable session'));
      }
      throw error;
    }
  },

  createException: async (data, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postSchedulingExceptions(data, options);
        return response?.data;
      }
      throw new Error('Scheduling exceptions are only available on Rust V2.');
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to create scheduling exception'));
      }
      throw error;
    }
  },

  cancelSession: async (id, reason, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postSchedulingSessionCancel(
          { id },
          { reason },
          options,
        );
        return response?.data;
      }
      throw new Error('Session management is only available on Rust V2.');
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to cancel bookable session'));
      }
      throw error;
    }
  },
};
