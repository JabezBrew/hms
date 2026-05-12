import { apiClient, handleApiError } from '@/lib/api-client';
import { v2Api } from '@/lib/api/v2/client';
import { handleV2ApiError } from '@/lib/api/v2/errors';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';

const BOARD_ENDPOINT = '/ward-board/';
const TASK_ACTIONS = new Set(['acknowledge', 'complete', 'cancel', 'escalate']);
const DEFAULT_BOARD_LIMIT = 25;
const MAX_BOARD_LIMIT = 100;

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

function normalizePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, MAX_BOARD_LIMIT);
}

function getV2BoardQuery(params = {}) {
  const limit = normalizePositiveInteger(
    params.limit ?? params.page_size ?? params.pageSize,
    DEFAULT_BOARD_LIMIT,
  );
  const cursor = params.cursor ?? params.next_cursor;
  const wardId = params.ward_id ?? params.ward;

  return {
    limit,
    ...(cursor ? { cursor } : {}),
    ...(wardId && wardId !== 'all' ? { ward_id: wardId } : {}),
  };
}

function adaptV2WardBoardItem(item = {}) {
  const patientName = item.patient_display_name || item.patient_name || item.name || 'Unnamed patient';

  return {
    ...item,
    id: item.admission_id,
    admission_id: item.admission_id,
    patient_id: item.patient_id,
    patient_name: patientName,
    name: patientName,
    display_name: patientName,
    medical_record_number: item.patient_code || item.medical_record_number || '',
    ward_id: item.ward_id,
    ward_name: item.ward_name || '',
    bed_id: item.bed_id ?? null,
    bed_label: item.bed_code || '',
    bed_name: item.bed_code || '',
    bed_number: item.bed_code || '',
    status: item.admission_status,
    admission_status: item.admission_status,
    open_task_count: item.open_nursing_task_count ?? 0,
    open_tasks_count: item.open_nursing_task_count ?? 0,
    due_medication_count: item.due_medication_count ?? 0,
    medication_due_count: item.due_medication_count ?? 0,
    tasks: [],
  };
}

function normalizeV2BoardResponse(response) {
  const rows = Array.isArray(response?.data) ? response.data.map(adaptV2WardBoardItem) : [];
  const nextCursor = response?.page?.next_cursor ?? null;
  return {
    count: response?.meta?.total ?? rows.length + (response?.page?.has_next ? 1 : 0),
    next: nextCursor,
    previous: null,
    next_cursor: nextCursor,
    results: rows,
  };
}

function wrapApiError(error, message) {
  rethrowAbortError(error);
  throw new Error(handleApiError(error, message));
}

function wrapV2ApiError(error, message) {
  rethrowAbortError(error);
  throw new Error(handleV2ApiError(error, message));
}

export const wardBoardApi = {
  getBoard: async (params = {}, options = {}) => {
    if (isRustV2ApiMode()) {
      try {
        const response = await v2Api.getWardBoard({
          query: getV2BoardQuery(params),
          signal: options.signal,
        });
        return normalizeV2BoardResponse(response);
      } catch (error) {
        wrapV2ApiError(error, 'Failed to fetch ward board');
      }
    }

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
