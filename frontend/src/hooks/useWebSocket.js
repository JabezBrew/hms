/**
 * React hooks for real-time WebSocket connections.
 *
 * Provides the notification websocket hook used by the app shell.
 */

import { useAuth } from '@/lib/auth';
import { useQueryClient } from '@tanstack/react-query';
import { useLatest } from '@/hooks/useLatest';
import { useAuthenticatedWebSocketToken } from '@/hooks/websocket/useAuthenticatedWebSocketToken';
import { useNotificationSocketConnection } from '@/hooks/websocket/useNotificationSocketConnection';

function canUseNotificationSocket(user) {
  return ['doctor', 'inpatient_doctor'].includes(user?.role);
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
  const onNotificationRef = useLatest(onNotification);
  const activeToken = useAuthenticatedWebSocketToken({
    enabled,
    isAuthenticated,
    getAccessToken,
    refreshAccessToken,
  });
  const shouldConnect = Boolean(activeToken && canUseNotificationSocket(user));

  return useNotificationSocketConnection({
    activeToken,
    shouldConnect,
    queryClient,
    onNotificationRef,
  });
}
