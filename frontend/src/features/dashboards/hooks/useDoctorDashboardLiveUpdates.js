import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { ClinicDashboardWebSocket, DoctorDashboardWebSocket } from '@/lib/websocket';
import { patchDashboardProjectionFreshness } from './realtimePatchesLiveUpdates';
import { useDashboardWebSocketToken } from './useDashboardWebSocketToken';

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

  const normalizedPractitionerId = normalizeToken(practitionerId);
  const normalizedTargetDate = normalizeDateToken(targetDate);
  const userRole = String(user?.role || '').toLowerCase();
  const shouldConnect = enabled && isAuthenticated && DOCTOR_ROLES.has(userRole) && Boolean(facilityCode);
  const [wsToken, setWsToken] = useDashboardWebSocketToken({ shouldConnect, getAccessToken, refreshAccessToken });

  useEffect(() => {
    if (!shouldConnect || !wsToken) {
      return undefined;
    }

    let isActive = true;
    const ws = stream === 'clinic'
      ? new ClinicDashboardWebSocket(wsToken)
      : new DoctorDashboardWebSocket(wsToken);
    wsRef.current = ws;

    const unsubscribeConnectionOpen = ws.on('connection.open', () => {
      setIsConnected(true);
      setConnectionError(null);
    });

    const unsubscribeConnectionClose = ws.on('connection.close', ({ code }) => {
      setIsConnected(false);
      if ((code === 4001 || code === 4003) && refreshAccessToken) {
        refreshAccessToken()
          .then((freshToken) => {
            if (isActive && freshToken) {
              setWsToken(freshToken);
            }
          })
          .catch(() => {});
      }
    });

    const unsubscribeConnectionError = ws.on('connection.error', ({ error }) => {
      setConnectionError(error || new Error('WebSocket connection failed'));
    });

    const unsubscribeConnectionFailed = ws.on('connection.failed', () => {
      setConnectionError(new Error('WebSocket reconnection attempts exhausted'));
    });

    const handleDashboardEvent = ({ dashboard, facility_code, practitioner_id, target_date, ...event }) => {
      if (dashboard && dashboard !== 'doctor') {
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

      const delta = { ...event, dashboard };
      if (stream === 'clinic') {
        if (patchDashboardProjectionFreshness(queryClient, ['dashboards', 'clinic'], delta, 'doctor')) {
          return;
        }
      } else if (patchDashboardProjectionFreshness(queryClient, ['dashboards', 'my-work'], delta, 'doctor')) {
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
    };

    const unsubscribeDashboardInvalidate = ws.on('dashboard.invalidate', handleDashboardEvent);
    const unsubscribeProjectionFreshness = ws.on('dashboard.projection_freshness', handleDashboardEvent);

    ws.connect();

    return () => {
      isActive = false;
      unsubscribeConnectionOpen();
      unsubscribeConnectionClose();
      unsubscribeConnectionError();
      unsubscribeConnectionFailed();
      unsubscribeDashboardInvalidate();
      unsubscribeProjectionFreshness();
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
    setWsToken,
  ]);

  return {
    isConnected,
    connectionError,
  };
}
