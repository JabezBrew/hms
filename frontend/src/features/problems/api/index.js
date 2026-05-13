import { apiClient, handleApiError } from '@/lib/api-client';
import { handleV2ApiError } from '@/lib/api/v2/errors';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { v2Api } from '@/lib/api/v2/client';

const DEFAULT_PROBLEM_PAGE_SIZE = 50;

function rethrowAbortError(error) {
  if (error?.name === 'AbortError') throw error;
}

function normalizeListResponse(response) {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.results)) return response.results;
  return [];
}

function adaptV2Problem(problem) {
  if (!problem) return problem;
  return {
    id: problem.id,
    patient: problem.patient_id,
    patient_id: problem.patient_id,
    label: problem.label,
    status: problem.status,
    clinical_status: problem.status,
    onset_date: problem.onset_date || null,
    created_at: problem.created_at,
    code_value: null,
    chronicity: null,
    priority: 'medium',
    verification_status: 'confirmed',
  };
}

function normalizePatientId(payload = {}) {
  const value = payload.patient_id || payload.patient;
  if (!value) {
    throw new Error('Patient is required for problem operations.');
  }
  if (typeof value === 'object') {
    return value.id || value.uuid;
  }
  return String(value);
}

function normalizeCreatePayload(payload = {}) {
  const label = String(payload.label || payload.free_text_label || payload.display || '').trim();
  if (!label) {
    throw new Error('Problem label is required.');
  }
  return {
    label,
    onset_date: payload.onset_date || null,
  };
}

function normalizeUpdatePayload(payload = {}) {
  const label = payload.label ?? payload.free_text_label ?? payload.display;
  const status = payload.status ?? payload.clinical_status;
  return {
    ...(label !== undefined ? { label: String(label).trim() } : {}),
    ...(payload.onset_date !== undefined ? { onset_date: payload.onset_date || null } : {}),
    ...(status ? { status } : {}),
  };
}

function unsupportedInRustV2(message) {
  return new Error(message);
}

export const problemsApi = {
  listForPatient: async (patientId, params = {}, options = {}) => {
    if (!patientId) return [];
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getPatientProblems(
          { patient_id: patientId },
          {
            query: {
              limit: Number(params.limit || params.page_size || DEFAULT_PROBLEM_PAGE_SIZE),
              cursor: params.cursor || params.next_cursor,
            },
            signal: options.signal,
          },
        );
        return Array.isArray(response?.data) ? response.data.map(adaptV2Problem) : [];
      }

      const response = await apiClient.getWithPagination('/problems/', {
        ...options,
        params: { patient: patientId, ...params },
      });
      return normalizeListResponse(response);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch problems'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch problems'));
    }
  },

  detail: async (id) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.getClinicalProblemById({ id });
        return adaptV2Problem(response?.data);
      }
      return await apiClient.get(`/problems/${id}/`);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch problem'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch problem'));
    }
  },

  create: async (payload) => {
    try {
      if (isRustV2ApiMode()) {
        const patientId = normalizePatientId(payload);
        const response = await v2Api.postPatientProblems(
          { patient_id: patientId },
          normalizeCreatePayload(payload),
        );
        return adaptV2Problem(response?.data);
      }

      return await apiClient.post('/problems/', payload);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to create problem'));
      }
      throw new Error(handleApiError(error, 'Failed to create problem'));
    }
  },

  update: async (id, payload) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.patchClinicalProblemById(
          { id },
          normalizeUpdatePayload(payload),
        );
        return adaptV2Problem(response?.data);
      }
      return await apiClient.patch(`/problems/${id}/`, payload);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to update problem'));
      }
      throw new Error(handleApiError(error, 'Failed to update problem'));
    }
  },

  changeStatus: async (id, payload) => {
    try {
      if (isRustV2ApiMode()) {
        const response = await v2Api.postClinicalProblemStatus(
          { id },
          { status: payload?.status || payload?.clinical_status },
        );
        return adaptV2Problem(response?.data);
      }
      return await apiClient.post(`/problems/${id}/change-status/`, payload);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to change status'));
      }
      throw new Error(handleApiError(error, 'Failed to change status'));
    }
  },

  searchCodes: async (q, params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        return [];
      }

      const response = await apiClient.get('/problems/codes/', {
        ...options,
        params: { q: q || '', ...params },
      });
      return normalizeListResponse(response);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to search codes'));
      }
      throw new Error(handleApiError(error, 'Failed to search codes'));
    }
  },

  listLinks: async (params = {}, options = {}) => {
    try {
      if (isRustV2ApiMode()) {
        return [];
      }

      const response = await apiClient.getWithPagination('/problems/links/', {
        ...options,
        params,
      });
      return normalizeListResponse(response);
    } catch (error) {
      rethrowAbortError(error);
      if (isRustV2ApiMode()) {
        throw new Error(handleV2ApiError(error, 'Failed to fetch problem links'));
      }
      throw new Error(handleApiError(error, 'Failed to fetch problem links'));
    }
  },

  createLink: async (payload) => {
    if (isRustV2ApiMode()) {
      throw unsupportedInRustV2('Rust V2 does not expose problem artifact links yet.');
    }
    try {
      return await apiClient.post('/problems/links/', payload);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to link problem'));
    }
  },

  deleteLink: async (id) => {
    if (isRustV2ApiMode()) {
      throw unsupportedInRustV2('Rust V2 does not expose problem artifact links yet.');
    }
    try {
      return await apiClient.delete(`/problems/links/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to remove problem link'));
    }
  },
};
