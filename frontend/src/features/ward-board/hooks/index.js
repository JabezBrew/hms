import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { createKeyFactory } from '@/shared/lib/queryKeys';
import { wardBoardApi } from '@/features/ward-board/api';
import { useAuth } from '@/lib/auth';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { WardBoardWebSocket } from '@/lib/websocket';

const baseKeys = createKeyFactory('ward-board');

export const wardBoardKeys = {
  ...baseKeys,
  board: (filters) => [...baseKeys.lists(), { filters }],
  patients: () => [...baseKeys.all, 'patients'],
  patient: (patientId) => [...baseKeys.all, 'patients', patientId],
};

const WARD_BOARD_ROLES = new Set([
  'admin',
  'doctor',
  'physician',
  'practitioner',
  'inpatient_doctor',
  'nurse',
  'head_nurse',
  'nurse_practitioner',
]);

function normalizeFacilityCode(value) {
  return value ? String(value).trim().toUpperCase() : null;
}

function normalizeWardScope(value) {
  if (!value || value === 'all') {
    return 'all';
  }
  return String(value).trim();
}

const TERMINAL_TASK_STATUSES = new Set(['completed', 'cancelled', 'done', 'closed']);
const TASK_EVENT_TYPES = new Set([
  'ward_board.task_state_changed',
  'ward_board.task_updated',
  'nursing.task_state_changed',
]);
const QUEUE_EVENT_TYPES = new Set([
  'ward_board.queue_status_updated',
  'ward_board.projection_freshness',
]);
const SAFE_TASK_FIELDS = new Set([
  'status',
  'state',
  'updated_at',
  'completed_at',
  'acknowledged_at',
  'cancelled_at',
  'escalated_at',
]);
const SAFE_QUEUE_FIELDS = new Set([
  'total_patients',
  'patients',
  'open_tasks',
  'tasks_open',
  'overdue',
  'overdue_tasks',
  'critical',
  'urgent',
  'pending_results',
  'results_pending',
  'discharge_blockers',
  'discharge_ready',
  'reviews',
  'my_work',
  'assigned_to_me',
  'last_updated',
  'generated_at',
  'queue_status',
]);

function normalizeId(value) {
  return value == null ? null : String(value);
}

function normalizeRealtimeDelta(event = {}) {
  if (event?.payload?.event_type) {
    return event.payload;
  }
  return event;
}

function getPatchSource(delta = {}) {
  return delta.patch && typeof delta.patch === 'object' ? delta.patch : delta;
}

function pickSafePatch(source, allowedFields) {
  return Object.fromEntries(
    Object.entries(source || {}).filter(([field]) => allowedFields.has(field))
  );
}

function getTaskStatusPatch(delta = {}) {
  const patch = getPatchSource(delta);
  return patch.status ?? patch.state ?? delta.status ?? delta.state ?? null;
}

function isTerminalStatus(status) {
  return TERMINAL_TASK_STATUSES.has(String(status || '').toLowerCase());
}

function getTaskId(task = {}) {
  return normalizeId(task.id ?? task.task_id ?? task.uuid);
}

function getPatientId(patient = {}) {
  return normalizeId(patient.patient_id ?? patient.id ?? patient.patient?.id ?? patient.patient_uuid);
}

function patchTaskArray(tasks, delta) {
  const taskId = normalizeId(delta.entity_id ?? delta.task_id ?? delta.id);
  const status = getTaskStatusPatch(delta);
  if (!taskId || !status || !Array.isArray(tasks)) {
    return { nextTasks: tasks, touched: false, wasOpen: false, isOpen: false };
  }

  let touched = false;
  let wasOpen = false;
  let isOpen = false;
  const patch = pickSafePatch(getPatchSource(delta), SAFE_TASK_FIELDS);
  const nextTasks = tasks.map((task) => {
    if (getTaskId(task) !== taskId) {
      return task;
    }
    touched = true;
    wasOpen = !isTerminalStatus(task.status ?? task.state);
    isOpen = !isTerminalStatus(status);
    return {
      ...task,
      ...patch,
      id: task.id ?? taskId,
      task_id: task.task_id ?? taskId,
      status,
      state: patch.state ?? status,
      updated_at: delta.occurred_at ?? patch.updated_at ?? task.updated_at,
      ...(isTerminalStatus(status) && !task.completed_at
        ? { completed_at: delta.occurred_at ?? patch.completed_at ?? new Date().toISOString() }
        : {}),
    };
  });

  return { nextTasks, touched, wasOpen, isOpen };
}

function adjustOpenTaskCounts(patient, wasOpen, isOpen) {
  if (wasOpen === isOpen) {
    return patient;
  }
  const delta = isOpen ? 1 : -1;
  const next = { ...patient };
  ['open_task_count', 'open_tasks_count', 'nursing_task_count'].forEach((field) => {
    if (typeof next[field] === 'number') {
      next[field] = Math.max(0, next[field] + delta);
    }
  });
  return next;
}

function patchPatientTasks(patient, delta, options = {}) {
  if (!patient || typeof patient !== 'object') {
    return patient;
  }

  const taskFields = ['tasks', 'open_tasks', 'clinical_tasks'];
  for (const field of taskFields) {
    const { nextTasks, touched, wasOpen, isOpen } = patchTaskArray(patient[field], delta);
    if (touched) {
      return adjustOpenTaskCounts({ ...patient, [field]: nextTasks }, wasOpen, isOpen);
    }
  }

  const localPatientId = normalizeId(options.patientId);
  const status = getTaskStatusPatch(delta);
  if (localPatientId && getPatientId(patient) === localPatientId && isTerminalStatus(status)) {
    return adjustOpenTaskCounts(patient, true, false);
  }

  return patient;
}

function patchPatientsCollection(collection, delta, options = {}) {
  if (!Array.isArray(collection)) {
    return { collection, touched: false };
  }
  let touched = false;
  const next = collection.map((patient) => {
    const updated = patchPatientTasks(patient, delta, options);
    if (updated !== patient) {
      touched = true;
    }
    return updated;
  });
  return { collection: touched ? next : collection, touched };
}

function patchWardBoardData(data, delta, options = {}) {
  if (Array.isArray(data)) {
    const { collection, touched } = patchPatientsCollection(data, delta, options);
    return touched ? collection : data;
  }
  if (!data || typeof data !== 'object') {
    return data;
  }

  if (Array.isArray(data.results)) {
    const { collection, touched } = patchPatientsCollection(data.results, delta, options);
    return touched ? { ...data, results: collection } : data;
  }
  if (Array.isArray(data.patients)) {
    const { collection, touched } = patchPatientsCollection(data.patients, delta, options);
    return touched ? { ...data, patients: collection } : data;
  }

  const patched = patchPatientTasks(data, delta, options);
  return patched;
}

function patchWardBoardQueueData(data, delta) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return data;
  }
  const safePatch = pickSafePatch(getPatchSource(delta), SAFE_QUEUE_FIELDS);
  if (Object.keys(safePatch).length === 0 && !delta.occurred_at) {
    return data;
  }

  return {
    ...data,
    summary: {
      ...(data.summary || {}),
      ...safePatch,
      last_updated: safePatch.last_updated ?? safePatch.generated_at ?? delta.occurred_at ?? data.summary?.last_updated,
    },
    last_updated: safePatch.last_updated ?? safePatch.generated_at ?? delta.occurred_at ?? data.last_updated,
  };
}

export function patchWardBoardTaskDelta(queryClient, event, options = {}) {
  const delta = normalizeRealtimeDelta(event);
  if (!TASK_EVENT_TYPES.has(delta.event_type)) {
    return false;
  }

  let patched = false;
  queryClient.setQueriesData({ queryKey: wardBoardKeys.lists() }, (current) => {
    const next = patchWardBoardData(current, delta, options);
    if (next !== current) {
      patched = true;
    }
    return next;
  });

  if (options.patientId) {
    queryClient.setQueryData(wardBoardKeys.patient(options.patientId), (current) => {
      const next = patchWardBoardData(current, delta, options);
      if (next !== current) {
        patched = true;
      }
      return next;
    });
  }

  return patched;
}

export function patchWardBoardQueueStatus(queryClient, event) {
  const delta = normalizeRealtimeDelta(event);
  if (!QUEUE_EVENT_TYPES.has(delta.event_type)) {
    return false;
  }

  let patched = false;
  queryClient.setQueriesData({ queryKey: wardBoardKeys.lists() }, (current) => {
    const next = patchWardBoardQueueData(current, delta);
    if (next !== current) {
      patched = true;
    }
    return next;
  });
  return patched;
}

function patchWardBoardRealtimeDelta(queryClient, event) {
  return patchWardBoardTaskDelta(queryClient, event) || patchWardBoardQueueStatus(queryClient, event);
}

function buildTaskDeltaFromAction(data, variables, fallbackStatus = null) {
  const status = data?.status ?? data?.state ?? fallbackStatus;
  return {
    event_type: 'ward_board.task_state_changed',
    entity_type: 'ward_board_task',
    entity_id: variables?.taskId,
    version: Date.now(),
    changed_fields: ['status'],
    occurred_at: data?.updated_at ?? data?.completed_at ?? new Date().toISOString(),
    patch: {
      ...(data && typeof data === 'object' ? data : {}),
      ...(status ? { status } : {}),
    },
  };
}

export function useWardBoard(filters = {}, options = {}) {
  return useQuery({
    queryKey: wardBoardKeys.board(filters),
    queryFn: ({ signal }) => wardBoardApi.getBoard(filters, { signal }),
    staleTime: 15 * 1000,
    placeholderData: (previousData) => previousData,
    ...options,
  });
}

export function useWardBoardPatient(patientId, options = {}) {
  return useQuery({
    queryKey: wardBoardKeys.patient(patientId),
    queryFn: ({ signal }) => wardBoardApi.getPatient(patientId, { signal }),
    enabled: Boolean(patientId),
    staleTime: 15 * 1000,
    ...options,
  });
}

export function useWardBoardTaskAction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ taskId, action, payload }) =>
      wardBoardApi.runTaskAction({ taskId, action, payload }),
    onMutate: async (variables) => {
      if (variables?.action !== 'complete') {
        return null;
      }
      await queryClient.cancelQueries({ queryKey: wardBoardKeys.lists() });
      const previousBoardQueries = queryClient.getQueriesData({ queryKey: wardBoardKeys.lists() });
      const previousPatient = variables.patientId
        ? queryClient.getQueryData(wardBoardKeys.patient(variables.patientId))
        : undefined;
      patchWardBoardTaskDelta(
        queryClient,
        buildTaskDeltaFromAction(null, variables, 'completed'),
        { patientId: variables.patientId },
      );
      return {
        previousBoardQueries,
        previousPatient,
        patientId: variables.patientId,
      };
    },
    onError: (_error, _variables, context) => {
      context?.previousBoardQueries?.forEach(([queryKey, data]) => {
        queryClient.setQueryData(queryKey, data);
      });
      if (context?.patientId) {
        queryClient.setQueryData(wardBoardKeys.patient(context.patientId), context.previousPatient);
      }
    },
    onSuccess: (_data, variables) => {
      const patched = patchWardBoardTaskDelta(
        queryClient,
        buildTaskDeltaFromAction(_data, variables, variables?.action === 'complete' ? 'completed' : null),
        { patientId: variables?.patientId },
      );
      if (!patched) {
        queryClient.invalidateQueries({ queryKey: wardBoardKeys.lists() });
        if (variables?.patientId) {
          queryClient.invalidateQueries({
            queryKey: wardBoardKeys.patient(variables.patientId),
          });
        }
      }
    },
  });
}

export function useWardBoardLiveUpdates(options = {}) {
  const { enabled = true, wardScope = 'all' } = options;
  const queryClient = useQueryClient();
  const { isAuthenticated, user, facilityCode, getAccessToken, refreshAccessToken } = useAuth();

  const wsRef = useRef(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState(null);
  const [wsToken, setWsToken] = useState(null);

  const normalizedWardScope = normalizeWardScope(wardScope);
  const userRole = String(user?.role || user?.user_type || '').toLowerCase();
  const shouldConnect = (
    enabled
    && !isRustV2ApiMode()
    && isAuthenticated
    && WARD_BOARD_ROLES.has(userRole)
    && Boolean(facilityCode)
  );

  useEffect(() => {
    let isMounted = true;

    if (!shouldConnect) {
      setWsToken(null);
      return () => {
        isMounted = false;
      };
    }

    const existingToken = getAccessToken?.();
    if (existingToken) {
      setWsToken(existingToken);
      return () => {
        isMounted = false;
      };
    }

    (async () => {
      try {
        const refreshed = await refreshAccessToken?.();
        if (isMounted) {
          setWsToken(refreshed || null);
        }
      } catch {
        if (isMounted) {
          setWsToken(null);
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [shouldConnect, getAccessToken, refreshAccessToken]);

  useEffect(() => {
    if (!shouldConnect || !wsToken) {
      return undefined;
    }

    const ws = new WardBoardWebSocket(wsToken, { wardScope: normalizedWardScope });
    wsRef.current = ws;

    ws.on('connection.open', () => {
      setIsConnected(true);
      setConnectionError(null);
    });

    ws.on('connection.close', ({ code }) => {
      setIsConnected(false);
      if ((code === 4001 || code === 4003) && refreshAccessToken) {
        refreshAccessToken()
          .then((freshToken) => {
            if (freshToken) {
              setWsToken(freshToken);
            }
          })
          .catch(() => {});
      }
    });

    ws.on('connection.error', ({ error }) => {
      setConnectionError(error || new Error('WebSocket connection failed'));
    });

    ws.on('connection.failed', () => {
      setConnectionError(new Error('WebSocket reconnection attempts exhausted'));
    });

    const handleWardBoardEvent = (event = {}) => {
      const { facility_code, ward_scope } = event;
      const eventFacility = normalizeFacilityCode(facility_code);
      const currentFacility = normalizeFacilityCode(facilityCode);
      if (eventFacility && currentFacility && eventFacility !== currentFacility) {
        return;
      }

      const eventWardScope = normalizeWardScope(ward_scope);
      if (
        normalizedWardScope !== 'all'
        && eventWardScope !== 'all'
        && eventWardScope !== normalizedWardScope
      ) {
        return;
      }

      if (patchWardBoardRealtimeDelta(queryClient, event)) {
        return;
      }
      queryClient.invalidateQueries({ queryKey: wardBoardKeys.lists() });
    };

    ws.on('ward_board.invalidate', handleWardBoardEvent);
    ws.on('ward_board.task_state_changed', handleWardBoardEvent);
    ws.on('ward_board.task_updated', handleWardBoardEvent);
    ws.on('ward_board.queue_status_updated', handleWardBoardEvent);
    ws.on('ward_board.projection_freshness', handleWardBoardEvent);

    ws.connect();

    return () => {
      ws.disconnect();
      wsRef.current = null;
      setIsConnected(false);
    };
  }, [
    shouldConnect,
    wsToken,
    facilityCode,
    normalizedWardScope,
    queryClient,
    refreshAccessToken,
  ]);

  return {
    isConnected,
    connectionError,
  };
}
