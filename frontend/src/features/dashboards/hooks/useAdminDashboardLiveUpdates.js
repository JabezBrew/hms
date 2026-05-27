import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { AdminDashboardWebSocket } from '@/lib/websocket';
import { dashboardKeys } from '@/hooks/useDashboardQueries';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import {
  patchDashboardProjectionFreshness,
  useLiveUpdateConnectionState,
} from './realtimePatchesLiveUpdates';
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
  const [connectionState, dispatchConnectionState] = useLiveUpdateConnectionState();

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

    const handleConnectionOpen = () => {
      dispatchConnectionState({ type: 'opened' });
    };

    const handleConnectionClose = ({ code }) => {
      dispatchConnectionState({ type: 'closed' });
      if ((code === 4001 || code === 4003) && refreshAccessToken) {
        refreshAccessToken()
          .then((freshToken) => {
            if (isActive && freshToken) {
              setWsToken(freshToken);
            }
          })
          .catch(() => {});
      }
    };

    const handleConnectionError = ({ error }) => {
      dispatchConnectionState({ type: 'errored', error });
    };

    const handleConnectionFailed = () => {
      dispatchConnectionState({ type: 'failed' });
    };

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

    ws.on('connection.open', handleConnectionOpen);
    ws.on('connection.close', handleConnectionClose);
    ws.on('connection.error', handleConnectionError);
    ws.on('connection.failed', handleConnectionFailed);
    ws.on('dashboard.invalidate', handleDashboardEvent);
    ws.on('dashboard.projection_freshness', handleDashboardEvent);

    ws.connect();

    return () => {
      isActive = false;
      ws.off('connection.open', handleConnectionOpen);
      ws.off('connection.close', handleConnectionClose);
      ws.off('connection.error', handleConnectionError);
      ws.off('connection.failed', handleConnectionFailed);
      ws.off('dashboard.invalidate', handleDashboardEvent);
      ws.off('dashboard.projection_freshness', handleDashboardEvent);
      ws.disconnect();
      wsRef.current = null;
      dispatchConnectionState({ type: 'closed' });
    };
  }, [
    shouldConnect,
    wsToken,
    facilityCode,
    queryClient,
    refreshAccessToken,
    setWsToken,
    dispatchConnectionState,
  ]);

  return connectionState;
}
