import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { ClinicDashboardWebSocket, DoctorDashboardWebSocket } from '@/lib/websocket';

function normalizeFacilityCode(value) {
  return value ? String(value).trim().toUpperCase() : null;
}

function normalizeToken(value) {
  return value ? String(value).trim() : null;
}

function normalizeDateToken(value) {
  if (!value) {
    return null;
  }
  const token = String(value).trim();
  return token || null;
}

const DOCTOR_ROLES = new Set(['doctor', 'physician', 'practitioner']);

export function useDoctorDashboardLiveUpdates(options = {}) {
  const {
    enabled = true,
    stream = 'my-work',
    practitionerId = null,
    targetDate = null,
    onInvalidate = null,
  } = options;

  const queryClient = useQueryClient();
  const { isAuthenticated, user, facilityCode, getAccessToken, refreshAccessToken } = useAuth();

  const wsRef = useRef(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState(null);
  const [wsToken, setWsToken] = useState(null);

  const normalizedPractitionerId = normalizeToken(practitionerId);
  const normalizedTargetDate = normalizeDateToken(targetDate);
  const userRole = String(user?.role || '').toLowerCase();
  const shouldConnect = enabled && isAuthenticated && DOCTOR_ROLES.has(userRole) && Boolean(facilityCode);

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

    const ws = stream === 'clinic'
      ? new ClinicDashboardWebSocket(wsToken)
      : new DoctorDashboardWebSocket(wsToken);
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

    ws.on('dashboard.invalidate', ({ dashboard, facility_code, practitioner_id, target_date }) => {
      if (dashboard !== 'doctor') {
        return;
      }

      const eventFacility = normalizeFacilityCode(facility_code);
      const currentFacility = normalizeFacilityCode(facilityCode);
      if (eventFacility && currentFacility && eventFacility !== currentFacility) {
        return;
      }

      const eventPractitionerId = normalizeToken(practitioner_id);
      if (
        normalizedPractitionerId
        && eventPractitionerId
        && eventPractitionerId !== normalizedPractitionerId
      ) {
        return;
      }

      const eventDate = normalizeDateToken(target_date);
      if (stream === 'clinic' && normalizedTargetDate && eventDate && eventDate !== normalizedTargetDate) {
        return;
      }

      if (typeof onInvalidate === 'function') {
        onInvalidate({
          dashboard,
          facilityCode: eventFacility,
          practitionerId: eventPractitionerId,
          targetDate: eventDate,
        });
        return;
      }

      if (stream === 'clinic') {
        queryClient.invalidateQueries({ queryKey: ['clinic-schedule'] });
        queryClient.invalidateQueries({ queryKey: ['dashboards', 'clinic'] });
      } else {
        queryClient.invalidateQueries({ queryKey: ['doctor-dashboard'] });
        queryClient.invalidateQueries({ queryKey: ['dashboards', 'my-work'] });
      }
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
    stream,
    facilityCode,
    normalizedPractitionerId,
    normalizedTargetDate,
    queryClient,
    refreshAccessToken,
    onInvalidate,
  ]);

  return {
    isConnected,
    connectionError,
  };
}
