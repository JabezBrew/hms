import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { NurseDashboardWebSocket } from '@/lib/websocket';

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
  const [wsToken, setWsToken] = useState(null);

  const normalizedWardScope = normalizeWardScope(wardScope);
  const userRole = String(user?.role || '').toLowerCase();
  const shouldConnect = enabled && isAuthenticated && NURSE_ROLES.has(userRole) && Boolean(facilityCode);

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

    const ws = new NurseDashboardWebSocket(wsToken, { wardScope: normalizedWardScope });
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

    ws.on('dashboard.invalidate', ({ dashboard, facility_code, ward_scope }) => {
      if (dashboard !== 'nurse') {
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

      queryClient.invalidateQueries({ queryKey: ['dashboards', 'nurse'] });
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
