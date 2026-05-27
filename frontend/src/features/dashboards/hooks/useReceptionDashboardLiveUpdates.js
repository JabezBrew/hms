import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { ReceptionDashboardWebSocket } from '@/lib/websocket';
import { dashboardKeys } from '@/hooks/useDashboardQueries';
import {
  patchDashboardProjectionFreshness,
  useLiveUpdateConnectionState,
} from './realtimePatchesLiveUpdates';
import { useDashboardWebSocketToken } from './useDashboardWebSocketToken';

function normalizeFacilityCode(value) {
  return value ? String(value).trim().toUpperCase() : null;
}

const RECEPTION_ROLES = new Set(['receptionist', 'admin_staff', 'admin']);

export function useReceptionDashboardLiveUpdates(options = {}) {
  const { enabled = true } = options;
  const queryClient = useQueryClient();
  const { isAuthenticated, user, facilityCode, getAccessToken, refreshAccessToken } = useAuth();

  const wsRef = useRef(null);
  const [connectionState, dispatchConnectionState] = useLiveUpdateConnectionState();

  const userRole = String(user?.role || '').toLowerCase();
  const shouldConnect = enabled && isAuthenticated && RECEPTION_ROLES.has(userRole) && Boolean(facilityCode);
  const [wsToken, setWsToken] = useDashboardWebSocketToken({ shouldConnect, getAccessToken, refreshAccessToken });

  useEffect(() => {
    if (!shouldConnect || !wsToken) {
      return undefined;
    }

    let isActive = true;
    const ws = new ReceptionDashboardWebSocket(wsToken);
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
      if (dashboard && dashboard !== 'reception') {
        return;
      }
      const eventFacility = normalizeFacilityCode(facility_code);
      const currentFacility = normalizeFacilityCode(facilityCode);
      if (eventFacility && currentFacility && eventFacility !== currentFacility) {
        return;
      }
      const delta = { ...event, dashboard };
      if (
        patchDashboardProjectionFreshness(
          queryClient,
          dashboardKeys.receptionist(),
          delta,
          'reception',
        )
      ) {
        return;
      }
      queryClient.invalidateQueries({ queryKey: dashboardKeys.receptionist() });
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
