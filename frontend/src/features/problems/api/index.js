import { apiClient, handleApiError } from '@/lib/api-client';

function rethrowAbortError(error) {
  if (error?.name === 'AbortError') throw error;
}

function normalizeListResponse(response) {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.results)) return response.results;
  return [];
}

export const problemsApi = {
  listForPatient: async (patientId, params = {}, options = {}) => {
    if (!patientId) return [];
    try {
      const response = await apiClient.getWithPagination('/problems/', {
        ...options,
        params: { patient: patientId, ...params },
      });
      return normalizeListResponse(response);
    } catch (error) {
      rethrowAbortError(error);
      throw new Error(handleApiError(error, 'Failed to fetch problems'));
    }
  },

  detail: async (id) => {
    try {
      return await apiClient.get(`/problems/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to fetch problem'));
    }
  },

  create: async (payload) => {
    try {
      return await apiClient.post('/problems/', payload);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to create problem'));
    }
  },

  update: async (id, payload) => {
    try {
      return await apiClient.patch(`/problems/${id}/`, payload);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to update problem'));
    }
  },

  changeStatus: async (id, payload) => {
    try {
      return await apiClient.post(`/problems/${id}/change-status/`, payload);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to change status'));
    }
  },

  searchCodes: async (q, params = {}, options = {}) => {
    try {
      const response = await apiClient.get('/problems/codes/', {
        ...options,
        params: { q: q || '', ...params },
      });
      return normalizeListResponse(response);
    } catch (error) {
      rethrowAbortError(error);
      throw new Error(handleApiError(error, 'Failed to search codes'));
    }
  },

  listLinks: async (params = {}, options = {}) => {
    try {
      const response = await apiClient.getWithPagination('/problems/links/', {
        ...options,
        params,
      });
      return normalizeListResponse(response);
    } catch (error) {
      rethrowAbortError(error);
      throw new Error(handleApiError(error, 'Failed to fetch problem links'));
    }
  },

  createLink: async (payload) => {
    try {
      return await apiClient.post('/problems/links/', payload);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to link problem'));
    }
  },

  deleteLink: async (id) => {
    try {
      return await apiClient.delete(`/problems/links/${id}/`);
    } catch (error) {
      throw new Error(handleApiError(error, 'Failed to remove problem link'));
    }
  },
};
