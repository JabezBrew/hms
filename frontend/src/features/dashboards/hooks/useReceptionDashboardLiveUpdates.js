import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { ReceptionDashboardWebSocket } from '@/lib/websocket';
import { dashboardKeys } from '@/hooks/useDashboardQueries';
import { patchDashboardProjectionFreshness } from './realtimePatchesLiveUpdates';

function normalizeFacilityCode(value) {
  return value ? String(value).trim().toUpperCase() : null;
}

const RECEPTION_ROLES = new Set(['receptionist', 'admin_staff', 'admin']);

export function useReceptionDashboardLiveUpdates(options = {}) {
  const { enabled = true } = options;
  const queryClient = useQueryClient();
  const { isAuthenticated, user, facilityCode, getAccessToken, refreshAccessToken } = useAuth();

  const wsRef = useRef(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionError, setConnectionError] = useState(null);
  const [wsToken, setWsToken] = useState(null);

  const userRole = String(user?.role || '').toLowerCase();
  const shouldConnect = enabled && isAuthenticated && RECEPTION_ROLES.has(userRole) && Boolean(facilityCode);

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

    const ws = new ReceptionDashboardWebSocket(wsToken);
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

    ws.on('dashboard.invalidate', handleDashboardEvent);
    ws.on('dashboard.projection_freshness', handleDashboardEvent);

    ws.connect();

    return () => {
      ws.disconnect();
      wsRef.current = null;
      setIsConnected(false);
    };
  }, [shouldConnect, wsToken, facilityCode, queryClient, refreshAccessToken]);

  return {
    isConnected,
    connectionError,
  };
}
