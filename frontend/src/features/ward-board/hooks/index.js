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
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: wardBoardKeys.lists() });
      if (variables?.patientId) {
        queryClient.invalidateQueries({
          queryKey: wardBoardKeys.patient(variables.patientId),
        });
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

    ws.on('ward_board.invalidate', ({ facility_code, ward_scope }) => {
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

      queryClient.invalidateQueries({ queryKey: wardBoardKeys.lists() });
    });

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
