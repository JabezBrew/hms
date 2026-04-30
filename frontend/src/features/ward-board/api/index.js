import { apiClient, handleApiError } from '@/lib/api-client';

const BOARD_ENDPOINT = '/ward-board/';
const TASK_ACTIONS = new Set(['acknowledge', 'complete', 'cancel', 'escalate']);

function rethrowAbortError(error) {
  if (error?.name === 'AbortError') {
    throw error;
  }
}

function shouldUseTaskFallback(error) {
  return error?.status === 404 || error?.status === 405;
}

function normalizeBoardResponse(response) {
  if (Array.isArray(response)) {
    return {
      count: response.length,
      next: null,
      previous: null,
      results: response,
    };
  }

  if (response && typeof response === 'object') {
    if (Array.isArray(response.results)) {
      return response;
    }

    if (Array.isArray(response.patients)) {
      return {
        ...response,
        count: response.count ?? response.patients.length,
        next: response.next ?? null,
        previous: response.previous ?? null,
        results: response.patients,
      };
    }
  }

  return {
    count: 0,
    next: null,
    previous: null,
    results: [],
  };
}

function wrapApiError(error, message) {
  rethrowAbortError(error);
  throw new Error(handleApiError(error, message));
}

export const wardBoardApi = {
  getBoard: async (params = {}, options = {}) => {
    try {
      const response = await apiClient.getWithPagination(BOARD_ENDPOINT, {
        ...options,
        params,
      });
      return normalizeBoardResponse(response);
    } catch (error) {
      wrapApiError(error, 'Failed to fetch ward board');
    }
  },

  getPatient: async (patientId, options = {}) => {
    try {
      return await apiClient.get(`/ward-board/patients/${patientId}/`, options);
    } catch (error) {
      wrapApiError(error, 'Failed to fetch ward board patient details');
    }
  },

  runTaskAction: async ({ taskId, action, payload = {} }) => {
    if (!taskId) {
      throw new Error('Task id is required');
    }
    if (!TASK_ACTIONS.has(action)) {
      throw new Error('Unsupported task action');
    }

    try {
      return await apiClient.post(`/ward-board/tasks/${taskId}/${action}/`, payload);
    } catch (error) {
      if (shouldUseTaskFallback(error)) {
        try {
          return await apiClient.patch(`/ward-board/tasks/${taskId}/`, {
            action,
            ...payload,
          });
        } catch (fallbackError) {
          wrapApiError(fallbackError, `Failed to ${action} ward board task`);
        }
      }
      wrapApiError(error, `Failed to ${action} ward board task`);
    }
  },

  acknowledgeTask: (taskId, payload) =>
    wardBoardApi.runTaskAction({ taskId, action: 'acknowledge', payload }),

  completeTask: (taskId, payload) =>
    wardBoardApi.runTaskAction({ taskId, action: 'complete', payload }),

  cancelTask: (taskId, payload) =>
    wardBoardApi.runTaskAction({ taskId, action: 'cancel', payload }),

  escalateTask: (taskId, payload) =>
    wardBoardApi.runTaskAction({ taskId, action: 'escalate', payload }),
};
