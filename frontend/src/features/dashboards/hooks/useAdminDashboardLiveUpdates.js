import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { AdminDashboardWebSocket } from '@/lib/websocket';
import { dashboardKeys } from '@/hooks/useDashboardQueries';

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
  const [wsToken, setWsToken] = useState(null);

  const shouldConnect = enabled && isAuthenticated && resolveRole(user) === 'admin' && Boolean(facilityCode);

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

    const ws = new AdminDashboardWebSocket(wsToken);
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

    ws.on('dashboard.invalidate', ({ dashboard, facility_code }) => {
      if (dashboard !== 'admin') {
        return;
      }
      const eventFacility = normalizeFacilityCode(facility_code);
      const currentFacility = normalizeFacilityCode(facilityCode);
      if (eventFacility && currentFacility && eventFacility !== currentFacility) {
        return;
      }
      queryClient.invalidateQueries({ queryKey: dashboardKeys.admin() });
      queryClient.invalidateQueries({ queryKey: dashboardKeys.adminV2Base() });
    });

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
