import { apiClient, handleApiError } from '@/lib/api-client';
import { v2Api, v2Request } from '@/lib/api/v2/client';
import {
  cacheCursorForNextPage as cacheScopedCursorForNextPage,
  resolveCursorPage as resolveScopedCursorPage,
} from '@/lib/api/v2/cursorCache';
import { handleV2ApiError } from '@/lib/api/v2/errors';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { hashQueryValue } from '@/shared/lib/privateQueryKey';

const BOARD_ENDPOINT = '/ward-board/';
const TASK_ACTIONS = new Set(['acknowledge', 'complete', 'cancel', 'escalate']);
const V2_TASK_ACTIONS = new Set(['complete', 'cancel']);
const DEFAULT_BOARD_LIMIT = 25;
const MAX_BOARD_LIMIT = 100;
const boardCursorCache = new Map();

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

function boardCursorCacheKey(_params = {}, limit) {
  const patientId = _params.patient_id ?? _params.patient ?? '';
  const filterKey = JSON.stringify({
    limit,
    scope: _params.scope === 'all' ? 'all' : '',
    ward_id: _params.ward_id ?? _params.ward ?? '',
    view: _params.view ?? '',
    monitoring_filter: _params.monitoring_filter ?? '',
    search: _params.search ? 'search' : '',
    patient_id: patientId ? hashQueryValue(patientId) : '',
  });
  return `ward-board:${filterKey}`;
}

function resolveBoardCursorPage(params = {}, limit) {
  return resolveScopedCursorPage(boardCursorCache, boardCursorCacheKey(params, limit), params);
}

function cacheBoardNextCursor(params = {}, limit, page, response) {
  cacheScopedCursorForNextPage(boardCursorCache, boardCursorCacheKey(params, limit), { ...params, page }, response);
}

function getV2BoardQuery(params = {}) {
  const limit = normalizePositiveInteger(
    params.limit ?? params.page_size ?? params.pageSize,
    DEFAULT_BOARD_LIMIT,
  );
  const { cursor } = resolveBoardCursorPage(params, limit);
  const wardId = params.ward_id ?? params.ward;
  const patientId = params.patient_id ?? params.patient;
  const monitoringFilter = params.monitoring_filter ?? viewToMonitoringFilter(params.view);
  const isAllWardScope = params.scope === 'all' || wardId === 'all';

  return {
    limit,
    ...(cursor ? { cursor } : {}),
    ...(wardId && !isAllWardScope ? { ward_id: wardId } : {}),
    ...(patientId ? { patient_id: patientId } : {}),
    ...(params.search ? { search: String(params.search).trim() } : {}),
    ...(monitoringFilter ? { monitoring_filter: monitoringFilter } : {}),
  };
}

function viewToMonitoringFilter(view) {
  switch (view) {
    case 'results':
      return 'results';
    case 'discharge':
      return 'discharge';
    case 'my-work':
      return 'my_work';
    default:
      return null;
  }
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

function humanize(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function isTerminalTaskStatus(status) {
  return ['completed', 'cancelled', 'done', 'closed'].includes(String(status || '').toLowerCase());
}

function adaptV2NursingTask(task = {}) {
  const taskType = task.task_type || task.type || 'nursing_task';
  const status = String(task.status || 'pending').toLowerCase();
  return {
    ...task,
    id: task.id,
    task_id: task.id,
    admission_id: task.admission_case_id,
    admission_case_id: task.admission_case_id,
    patient_id: task.patient_id,
    patient_name: task.patient_display_name,
    medical_record_number: task.patient_code,
    category: humanize(taskType),
    type: taskType,
    title: task.title || task.instruction || humanize(taskType),
    summary: task.instruction || task.title || humanize(taskType),
    status,
    urgency: status === 'open' ? 'pending' : status,
    _action_source: 'nursing_task',
  };
}

async function getV2PatientBoardDetail(patientId, options = {}) {
  const taskResponse = await v2Api.getNursingTasks({
    query: { limit: 50, patient_id: patientId },
    signal: options.signal,
  });
  const tasks = (Array.isArray(taskResponse?.data) ? taskResponse.data : [])
    .map(adaptV2NursingTask);

  return {
    id: patientId,
    patient_id: patientId,
    tasks,
    ...(tasks.length > 0
      ? { open_task_count: tasks.filter((task) => !isTerminalTaskStatus(task.status)).length }
      : {}),
  };
}

function normalizeV2BoardResponse(response, params = {}) {
  const rows = Array.isArray(response?.data) ? response.data.map(adaptV2WardBoardItem) : [];
  const limit = normalizePositiveInteger(
    params.limit ?? params.page_size ?? params.pageSize,
    DEFAULT_BOARD_LIMIT,
  );
  const resolved = resolveBoardCursorPage(params, limit);
  const hasNext = Boolean(response?.page?.has_next && response?.page?.next_cursor);
  const knownCount = ((resolved.page - 1) * limit) + rows.length;
  const nextCursor = response?.page?.next_cursor ?? null;
  cacheBoardNextCursor(params, limit, resolved.page, response);

  return {
    count: response?.meta?.total ?? knownCount + (hasNext ? 1 : 0),
    count_exact: response?.meta?.total !== undefined || !hasNext,
    total_is_lower_bound: response?.meta?.total === undefined && hasNext,
    page: resolved.page,
    current_page: resolved.page,
    requested_page: resolved.requestedPage ?? resolved.page,
    resolved_page: resolved.page,
    cursor_missing: Boolean(resolved.cursorMissing),
    page_size: limit,
    total_pages: hasNext ? resolved.page + 1 : Math.max(1, resolved.page),
    next: hasNext ? nextCursor : null,
    previous: resolved.page > 1 ? String(resolved.page - 1) : null,
    next_cursor: nextCursor,
    results: rows,
  };
}

function normalizeBoardContext(response) {
  const data = response?.data && typeof response.data === 'object' ? response.data : response || {};
  const assignedWards = Array.isArray(data.assigned_wards) ? data.assigned_wards : [];
  return {
    assigned_wards: assignedWards,
    primary_ward_id: data.primary_ward_id ?? null,
    default_ward_id: data.default_ward_id ?? null,
    can_view_all_wards: Boolean(data.can_view_all_wards),
    default_route: data.default_route || '/ward-board',
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
  getBoardContext: async (options = {}) => {
    if (isRustV2ApiMode()) {
      try {
        const response = await v2Api.getMyWardBoardContext({
          signal: options.signal,
        });
        return normalizeBoardContext(response);
      } catch (error) {
        wrapV2ApiError(error, 'Failed to fetch ward board context');
      }
    }

    return normalizeBoardContext({
      assigned_wards: [],
      primary_ward_id: null,
      default_ward_id: null,
      can_view_all_wards: true,
      default_route: '/ward-board',
    });
  },

  getBoard: async (params = {}, options = {}) => {
    if (isRustV2ApiMode()) {
      try {
        const query = getV2BoardQuery(params);
        const response = query.search || query.patient_id
          ? await v2Request({
              method: 'POST',
              path: '/api/v2/wards/board/search',
              body: query,
              signal: options.signal,
            })
          : await v2Api.getWardBoard({
              query,
              signal: options.signal,
            });
        return normalizeV2BoardResponse(response, params);
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
    if (isRustV2ApiMode()) {
      try {
        return await getV2PatientBoardDetail(patientId, options);
      } catch (error) {
        wrapV2ApiError(error, 'Failed to fetch ward board patient details');
      }
    }

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

    if (isRustV2ApiMode()) {
      if (!V2_TASK_ACTIONS.has(action)) {
        throw new Error('Unsupported task action in Rust V2 mode');
      }

      try {
        const response = action === 'complete'
          ? await v2Api.postNursingTaskComplete({ id: taskId }, { signal: payload?.signal })
          : await v2Api.postNursingTaskCancel({ id: taskId }, { signal: payload?.signal });
        return response?.data || response;
      } catch (error) {
        wrapV2ApiError(error, `Failed to ${action} ward board task`);
      }
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
