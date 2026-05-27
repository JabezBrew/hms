import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { InpatientDashboardWebSocket } from '@/lib/websocket';
import { dashboardKeys } from '@/hooks/useDashboardQueries';
import {
  patchDashboardProjectionFreshness,
  useLiveUpdateConnectionState,
} from './realtimePatchesLiveUpdates';
import { useDashboardWebSocketToken } from './useDashboardWebSocketToken';

function normalizeFacilityCode(value) {
  return value ? String(value).trim().toUpperCase() : null;
}

const INPATIENT_ROLES = new Set(['doctor', 'physician', 'practitioner', 'admin']);

export function useInpatientDashboardLiveUpdates(options = {}) {
  const { enabled = true } = options;
  const queryClient = useQueryClient();
  const { isAuthenticated, user, facilityCode, getAccessToken, refreshAccessToken } = useAuth();

  const wsRef = useRef(null);
  const [connectionState, dispatchConnectionState] = useLiveUpdateConnectionState();

  const userRole = String(user?.role || '').toLowerCase();
  const shouldConnect = enabled && isAuthenticated && INPATIENT_ROLES.has(userRole) && Boolean(facilityCode);
  const [wsToken, setWsToken] = useDashboardWebSocketToken({ shouldConnect, getAccessToken, refreshAccessToken });

  useEffect(() => {
    if (!shouldConnect || !wsToken) {
      return undefined;
    }

    let isActive = true;
    const ws = new InpatientDashboardWebSocket(wsToken);
    wsRef.current = ws;

    const unsubscribeConnectionOpen = ws.on('connection.open', () => {
      dispatchConnectionState({ type: 'opened' });
    });

    const unsubscribeConnectionClose = ws.on('connection.close', ({ code }) => {
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
    });

    const unsubscribeConnectionError = ws.on('connection.error', ({ error }) => {
      dispatchConnectionState({ type: 'errored', error });
    });

    const unsubscribeConnectionFailed = ws.on('connection.failed', () => {
      dispatchConnectionState({ type: 'failed' });
    });

    const handleDashboardEvent = ({ dashboard, facility_code, ...event }) => {
      if (dashboard && dashboard !== 'inpatient') {
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
          dashboardKeys.inpatient(),
          delta,
          'inpatient',
        )
      ) {
        return;
      }
      queryClient.invalidateQueries({ queryKey: dashboardKeys.inpatient() });
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
