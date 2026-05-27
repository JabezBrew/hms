/**
 * React hooks for real-time WebSocket connections.
 *
 * Provides the notification websocket hook used by the app shell.
 */

import { useEffect, useRef, useCallback, useReducer, useState } from 'react';
import { NotificationWebSocket } from '@/lib/websocket';
import { useAuth } from '@/lib/auth';
import { useQueryClient } from '@tanstack/react-query';
import { useLatest } from '@/hooks/useLatest';
import { referralKeys } from '@/hooks/useReferralQueries';

const initialConnectionState = {
  isConnected: false,
  connectionError: null,
};

function connectionReducer(state, action) {
  switch (action.type) {
    case 'opened':
      return { isConnected: true, connectionError: null };
    case 'closed':
      return { ...state, isConnected: false };
    case 'errored':
      return { ...state, connectionError: action.error };
    case 'failed':
      return { ...state, connectionError: new Error('Max reconnection attempts reached') };
    default:
      return state;
  }
}

/**
 * Hook for subscribing to real-time referral notifications.
 *
 * @param {Object} options Configuration options
 * @param {boolean} options.enabled - Whether to connect (default: true)
 * @param {Function} options.onNotification - Callback when new notification received
 *
 * @returns {Object} WebSocket state and notifications
 *
 * @example
 * const { isConnected, notifications } = useNotificationWebSocket({
 *   onNotification: (notification) => toast.info('New referral notification')
 * });
 */
export function useNotificationWebSocket(options = {}) {
  const { enabled = true, onNotification } = options;
  const { getAccessToken, refreshAccessToken, isAuthenticated, user } = useAuth();
  const queryClient = useQueryClient();

  const wsRef = useRef(null);
  const [notifications, setNotifications] = useState([]);
  const [token, setToken] = useState(null);
  const [connectionState, dispatchConnectionState] = useReducer(
    connectionReducer,
    initialConnectionState,
  );

  // Use ref for callback to prevent effect re-runs
  const onNotificationRef = useLatest(onNotification);

  // Only enable for doctors
  const currentAccessToken = enabled && isAuthenticated ? getAccessToken?.() : null;
  const activeToken = currentAccessToken || (enabled && isAuthenticated ? token : null);
  const shouldConnect = Boolean(activeToken && ['doctor', 'inpatient_doctor'].includes(user?.role));

  useEffect(() => {
    let isMounted = true;

    if (!enabled || !isAuthenticated || currentAccessToken) {
      return () => {
        isMounted = false;
      };
    }

    (async () => {
      try {
        const refreshed = await refreshAccessToken?.();
        if (isMounted) {
          setToken(refreshed || null);
        }
      } catch {
        if (isMounted) {
          setToken(null);
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [enabled, isAuthenticated, currentAccessToken, refreshAccessToken]);

  useEffect(() => {
    if (!shouldConnect) {
      return;
    }

    const ws = new NotificationWebSocket(activeToken);
    wsRef.current = ws;

    const handleConnectionOpen = () => {
      dispatchConnectionState({ type: 'opened' });
    };

    const handleConnectionClose = () => {
      dispatchConnectionState({ type: 'closed' });
    };

    const handleConnectionError = ({ error }) => {
      dispatchConnectionState({ type: 'errored', error });
    };

    const handleConnectionFailed = () => {
      dispatchConnectionState({ type: 'failed' });
    };

    const handleNotificationNew = ({ notification }) => {
      setNotifications((prev) => [notification, ...prev].slice(0, 50)); // Keep last 50

      // Invalidate React Query cache to refresh counts
      queryClient.invalidateQueries({ queryKey: referralKeys.notifications() });
      queryClient.invalidateQueries({ queryKey: referralKeys.notificationCount() });
      queryClient.invalidateQueries({ queryKey: referralKeys.inboxCount() });

      onNotificationRef.current?.(notification);
    };

    ws.on('connection.open', handleConnectionOpen);
    ws.on('connection.close', handleConnectionClose);
    ws.on('connection.error', handleConnectionError);
    ws.on('connection.failed', handleConnectionFailed);
    ws.on('notification.new', handleNotificationNew);

    // Connect
    ws.connect();

    // Cleanup on unmount
    return () => {
      ws.off('connection.open', handleConnectionOpen);
      ws.off('connection.close', handleConnectionClose);
      ws.off('connection.error', handleConnectionError);
      ws.off('connection.failed', handleConnectionFailed);
      ws.off('notification.new', handleNotificationNew);
      ws.disconnect();
      wsRef.current = null;
    };
  }, [shouldConnect, activeToken, queryClient, onNotificationRef]);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  return {
    isConnected: shouldConnect && connectionState.isConnected,
    connectionError: connectionState.connectionError,
    notifications,
    clearNotifications,
  };
}
