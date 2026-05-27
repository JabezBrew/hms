import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { NotificationWebSocket } from '@/lib/websocket';
import { referralKeys } from '@/hooks/useReferralQueries';

const MAX_NOTIFICATIONS = 50;

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

export function useNotificationSocketConnection({
  activeToken,
  shouldConnect,
  queryClient,
  onNotificationRef,
}) {
  const wsRef = useRef(null);
  const [notifications, setNotifications] = useState([]);
  const [connectionState, dispatchConnectionState] = useReducer(
    connectionReducer,
    initialConnectionState,
  );

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
      setNotifications((prev) => [notification, ...prev].slice(0, MAX_NOTIFICATIONS));

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

    ws.connect();

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
