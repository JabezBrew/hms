/**
 * React hooks for real-time WebSocket connections.
 *
 * Provides useAlertWebSocket and useVitalsWebSocket hooks for
 * subscribing to real-time nursing alerts and vital signs.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { AlertWebSocket, VitalsWebSocket, NotificationWebSocket } from '@/lib/websocket';
import { useAuth } from '@/lib/auth';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Hook for subscribing to real-time nursing alerts.
 *
 * @param {Object} options Configuration options
 * @param {string} options.wardId - Optional ward ID to filter alerts
 * @param {boolean} options.enabled - Whether to connect (default: true)
 * @param {Function} options.onAlert - Callback when new alert received
 * @param {Function} options.onAcknowledged - Callback when alert acknowledged
 *
 * @returns {Object} WebSocket state and controls
 *
 * @example
 * const { isConnected, alerts } = useAlertWebSocket({
 *   wardId: '123',
 *   onAlert: (alert) => toast.warning(alert.message)
 * });
 */
export function useAlertWebSocket(options = {}) {
  const { wardId, enabled = true, onAlert, onAcknowledged, onEscalated } = options;
  const { token, isAuthenticated } = useAuth();

  const wsRef = useRef(null);
  const [isConnected, setIsConnected] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [connectionError, setConnectionError] = useState(null);

  // Create WebSocket instance
  useEffect(() => {
    if (!enabled || !isAuthenticated || !token) {
      return;
    }

    const ws = new AlertWebSocket(token, { wardId });
    wsRef.current = ws;

    // Connection handlers
    ws.on('connection.open', () => {
      setIsConnected(true);
      setConnectionError(null);
    });

    ws.on('connection.close', () => {
      setIsConnected(false);
    });

    ws.on('connection.error', ({ error }) => {
      setConnectionError(error);
    });

    ws.on('connection.failed', () => {
      setConnectionError(new Error('Max reconnection attempts reached'));
    });

    // Alert handlers
    ws.on('alert.new', ({ alert }) => {
      setAlerts((prev) => [alert, ...prev].slice(0, 50)); // Keep last 50
      onAlert?.(alert);
    });

    ws.on('alert.acknowledged', ({ alert_id, acknowledged_by }) => {
      setAlerts((prev) =>
        prev.map((a) =>
          a.id === alert_id ? { ...a, is_acknowledged: true, acknowledged_by } : a
        )
      );
      onAcknowledged?.({ alert_id, acknowledged_by });
    });

    ws.on('alert.escalated', ({ alert, previous_severity }) => {
      setAlerts((prev) =>
        prev.map((a) => (a.id === alert.id ? alert : a))
      );
      onEscalated?.({ alert, previous_severity });
    });

    // Connect
    ws.connect();

    // Cleanup on unmount
    return () => {
      ws.disconnect();
      wsRef.current = null;
    };
  }, [enabled, isAuthenticated, token, wardId, onAlert, onAcknowledged, onEscalated]);

  // Methods
  const subscribeToWard = useCallback((newWardId) => {
    wsRef.current?.subscribeToWard(newWardId);
  }, []);

  const unsubscribeFromWard = useCallback((wardIdToRemove) => {
    wsRef.current?.unsubscribeFromWard(wardIdToRemove);
  }, []);

  const clearAlerts = useCallback(() => {
    setAlerts([]);
  }, []);

  return {
    isConnected,
    connectionError,
    alerts,
    subscribeToWard,
    unsubscribeFromWard,
    clearAlerts,
  };
}

/**
 * Hook for subscribing to real-time vital signs for a patient.
 *
 * @param {string} patientId - Patient ID to subscribe to
 * @param {Object} options Configuration options
 * @param {boolean} options.enabled - Whether to connect (default: true)
 * @param {Function} options.onVitals - Callback when new vitals received
 * @param {Function} options.onCritical - Callback when critical vitals detected
 *
 * @returns {Object} WebSocket state and latest vitals
 *
 * @example
 * const { isConnected, latestVitals } = useVitalsWebSocket(patientId, {
 *   onCritical: (vitals) => showCriticalAlert(vitals)
 * });
 */
export function useVitalsWebSocket(patientId, options = {}) {
  const { enabled = true, onVitals, onCritical } = options;
  const { token, isAuthenticated } = useAuth();

  const wsRef = useRef(null);
  const [isConnected, setIsConnected] = useState(false);
  const [latestVitals, setLatestVitals] = useState(null);
  const [vitalsHistory, setVitalsHistory] = useState([]);

  useEffect(() => {
    if (!enabled || !isAuthenticated || !token || !patientId) {
      return;
    }

    const ws = new VitalsWebSocket(patientId, token);
    wsRef.current = ws;

    ws.on('connection.open', () => {
      setIsConnected(true);
    });

    ws.on('connection.close', () => {
      setIsConnected(false);
    });

    ws.on('vitals.new', ({ vitals }) => {
      setLatestVitals(vitals);
      setVitalsHistory((prev) => [vitals, ...prev].slice(0, 20)); // Keep last 20
      onVitals?.(vitals);
    });

    ws.on('vitals.critical', ({ vitals, alert }) => {
      setLatestVitals(vitals);
      setVitalsHistory((prev) => [vitals, ...prev].slice(0, 20));
      onVitals?.(vitals);
      onCritical?.({ vitals, alert });
    });

    ws.connect();

    return () => {
      ws.disconnect();
      wsRef.current = null;
    };
  }, [enabled, isAuthenticated, token, patientId, onVitals, onCritical]);

  return {
    isConnected,
    latestVitals,
    vitalsHistory,
  };
}

/**
 * Hook for checking WebSocket support and connection status.
 * Useful for showing connection indicators in the UI.
 */
export function useWebSocketStatus() {
  const [isSupported] = useState(() => 'WebSocket' in window);
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return {
    isSupported,
    isOnline,
  };
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
  const { token, isAuthenticated, user } = useAuth();
  const queryClient = useQueryClient();

  const wsRef = useRef(null);
  const [isConnected, setIsConnected] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [connectionError, setConnectionError] = useState(null);

  // Only enable for doctors
  const shouldConnect = enabled && isAuthenticated && token && ['doctor', 'inpatient_doctor'].includes(user?.role);

  useEffect(() => {
    if (!shouldConnect) {
      return;
    }

    const ws = new NotificationWebSocket(token);
    wsRef.current = ws;

    // Connection handlers
    ws.on('connection.open', () => {
      setIsConnected(true);
      setConnectionError(null);
    });

    ws.on('connection.close', () => {
      setIsConnected(false);
    });

    ws.on('connection.error', ({ error }) => {
      setConnectionError(error);
    });

    ws.on('connection.failed', () => {
      setConnectionError(new Error('Max reconnection attempts reached'));
    });

    // Notification handler
    ws.on('notification.new', ({ notification }) => {
      setNotifications((prev) => [notification, ...prev].slice(0, 50)); // Keep last 50

      // Invalidate React Query cache to refresh counts
      queryClient.invalidateQueries({ queryKey: ['referralNotifications'] });
      queryClient.invalidateQueries({ queryKey: ['referralNotificationCount'] });

      onNotification?.(notification);
    });

    // Connect
    ws.connect();

    // Cleanup on unmount
    return () => {
      ws.disconnect();
      wsRef.current = null;
    };
  }, [shouldConnect, token, onNotification, queryClient]);

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

export default {
  useAlertWebSocket,
  useVitalsWebSocket,
  useWebSocketStatus,
  useNotificationWebSocket,
};
