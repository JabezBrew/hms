/**
 * React hooks for real-time WebSocket connections.
 *
 * Provides the notification websocket hook used by the app shell.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { NotificationWebSocket } from '@/lib/websocket';
import { useAuth } from '@/lib/auth';
import { useQueryClient } from '@tanstack/react-query';
import { useLatest } from '@/hooks/useLatest';
import { referralKeys } from '@/hooks/useReferralQueries';

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
  const [isConnected, setIsConnected] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [connectionError, setConnectionError] = useState(null);
  const [token, setToken] = useState(null);

  // Use ref for callback to prevent effect re-runs
  const onNotificationRef = useLatest(onNotification);

  // Only enable for doctors
  const shouldConnect = enabled && isAuthenticated && token && ['doctor', 'inpatient_doctor'].includes(user?.role);

  useEffect(() => {
    let isMounted = true;

    if (!enabled || !isAuthenticated) {
      setToken(null);
      return () => {
        isMounted = false;
      };
    }

    const existingToken = getAccessToken?.();
    if (existingToken) {
      setToken(existingToken);
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
  }, [enabled, isAuthenticated, getAccessToken, refreshAccessToken]);

  useEffect(() => {
    if (!shouldConnect) {
      return;
    }

    const ws = new NotificationWebSocket(token);
    wsRef.current = ws;

    // Connection handlers
    const unsubscribeConnectionOpen = ws.on('connection.open', () => {
      setIsConnected(true);
      setConnectionError(null);
    });

    const unsubscribeConnectionClose = ws.on('connection.close', () => {
      setIsConnected(false);
    });

    const unsubscribeConnectionError = ws.on('connection.error', ({ error }) => {
      setConnectionError(error);
    });

    const unsubscribeConnectionFailed = ws.on('connection.failed', () => {
      setConnectionError(new Error('Max reconnection attempts reached'));
    });

    // Notification handler - use ref to get latest callback without re-running effect
    const unsubscribeNotificationNew = ws.on('notification.new', ({ notification }) => {
      setNotifications((prev) => [notification, ...prev].slice(0, 50)); // Keep last 50

      // Invalidate React Query cache to refresh counts
      queryClient.invalidateQueries({ queryKey: referralKeys.notifications() });
      queryClient.invalidateQueries({ queryKey: referralKeys.notificationCount() });
      queryClient.invalidateQueries({ queryKey: referralKeys.inboxCount() });

      onNotificationRef.current?.(notification);
    });

    // Connect
    ws.connect();

    // Cleanup on unmount
    return () => {
      unsubscribeConnectionOpen();
      unsubscribeConnectionClose();
      unsubscribeConnectionError();
      unsubscribeConnectionFailed();
      unsubscribeNotificationNew();
      ws.disconnect();
      wsRef.current = null;
    };
  }, [shouldConnect, token, queryClient, onNotificationRef]);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  return {
    isConnected,
    connectionError,
    notifications,
    clearNotifications,
  };
}
