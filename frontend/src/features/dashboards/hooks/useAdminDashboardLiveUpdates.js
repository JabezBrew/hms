import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { AdminDashboardWebSocket } from '@/lib/websocket';
import { dashboardKeys } from '@/hooks/useDashboardQueries';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { patchDashboardProjectionFreshness } from './realtimePatchesLiveUpdates';
import { useDashboardWebSocketToken } from './useDashboardWebSocketToken';

function normalizeFacilityCode(value) {
  return value ? String(value).trim().toUpperCase() : null;
}

function resolveRole(user) {
  return (user?.role || user?.user_type || '').toLowerCase();
}

export function useAdminDashboardLiveUpdates(options = {}) {
  const { enabled = true } = options;
  const queryClient = useQueryClient();
  const { isAuthenticated, user, facilityCode, getAccessToken, refreshAccessToken } = useAuth();

  const wsRef = useRef(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState(null);

  const shouldConnect = (
    enabled
    && !isRustV2ApiMode()
    && isAuthenticated
    && resolveRole(user) === 'admin'
    && Boolean(facilityCode)
  );
  const [wsToken, setWsToken] = useDashboardWebSocketToken({ shouldConnect, getAccessToken, refreshAccessToken });

  useEffect(() => {
    if (!shouldConnect || !wsToken) {
      return undefined;
    }

    let isActive = true;
    const ws = new AdminDashboardWebSocket(wsToken);
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

    const handleDashboardEvent = ({ dashboard, facility_code, ...event }) => {
      if (dashboard && dashboard !== 'admin') {
        return;
      }
      const eventFacility = normalizeFacilityCode(facility_code);
      const currentFacility = normalizeFacilityCode(facilityCode);
      if (eventFacility && currentFacility && eventFacility !== currentFacility) {
        return;
      }
      const delta = { ...event, dashboard };
      const patchedRoot = patchDashboardProjectionFreshness(
        queryClient,
        dashboardKeys.admin(),
        delta,
        'admin',
      );
      const patchedV2 = patchDashboardProjectionFreshness(
        queryClient,
        dashboardKeys.adminV2Base(),
        delta,
        'admin',
      );
      if (patchedRoot || patchedV2) {
        return;
      }
      queryClient.invalidateQueries({ queryKey: dashboardKeys.admin() });
      queryClient.invalidateQueries({ queryKey: dashboardKeys.adminV2Base() });
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
  }, [shouldConnect, wsToken, facilityCode, queryClient, refreshAccessToken, setWsToken]);

  return {
    isConnected,
    connectionError,
  };
}
