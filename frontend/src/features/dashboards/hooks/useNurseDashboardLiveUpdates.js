import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { NurseDashboardWebSocket } from '@/lib/websocket';
import { patchDashboardProjectionFreshness } from './realtimePatchesLiveUpdates';
import { useDashboardWebSocketToken } from './useDashboardWebSocketToken';

function normalizeFacilityCode(value) {
  return value ? String(value).trim().toUpperCase() : null;
}

function normalizeWardScope(value) {
  if (!value || value === 'all') {
    return 'all';
  }
  return String(value).trim();
}

const NURSE_ROLES = new Set(['nurse', 'head_nurse', 'nurse_practitioner', 'admin']);

export function useNurseDashboardLiveUpdates(options = {}) {
  const { enabled = true, wardScope = 'all' } = options;
  const queryClient = useQueryClient();
  const { isAuthenticated, user, facilityCode, getAccessToken, refreshAccessToken } = useAuth();

  const wsRef = useRef(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState(null);

  const normalizedWardScope = normalizeWardScope(wardScope);
  const userRole = String(user?.role || '').toLowerCase();
  const shouldConnect = enabled && isAuthenticated && NURSE_ROLES.has(userRole) && Boolean(facilityCode);
  const [wsToken, setWsToken] = useDashboardWebSocketToken({ shouldConnect, getAccessToken, refreshAccessToken });

  useEffect(() => {
    if (!shouldConnect || !wsToken) {
      return undefined;
    }

    let isActive = true;
    const ws = new NurseDashboardWebSocket(wsToken, { wardScope: normalizedWardScope });
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

    const handleDashboardEvent = ({ dashboard, facility_code, ward_scope, ...event }) => {
      if (dashboard && dashboard !== 'nurse') {
        return;
      }
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

      const delta = { ...event, dashboard };
      if (patchDashboardProjectionFreshness(queryClient, ['dashboards', 'nurse'], delta, 'nurse')) {
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['dashboards', 'nurse'] });
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
    facilityCode,
    normalizedWardScope,
    queryClient,
    refreshAccessToken,
    setWsToken,
  ]);

  return {
    isConnected,
    connectionError,
  };
}
