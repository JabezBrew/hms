import { useState, useSyncExternalStore } from 'react';

/**
 * Shared online status store using a singleton pattern.
 * This ensures only one set of event listeners exists across all components.
 */
const ONLINE_SERVER_SNAPSHOT = { isOnline: true, reconnectVersion: 0 };

const onlineStatusStore = {
  listeners: new Set(),
  snapshot: {
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    reconnectVersion: 0,
  },
  wasOffline: false,

  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  },

  getSnapshot() {
    return this.snapshot;
  },

  getServerSnapshot() {
    return ONLINE_SERVER_SNAPSHOT; // Assume online during SSR
  },

  getIsOnlineSnapshot() {
    return this.snapshot.isOnline;
  },

  getIsOnlineServerSnapshot() {
    return true;
  },

  setOnlineStatus(isOnline) {
    if (this.snapshot.isOnline === isOnline) {
      return;
    }

    const wasOfflineBeforeUpdate = this.wasOffline || !this.snapshot.isOnline;
    this.wasOffline = !isOnline;
    this.snapshot = {
      isOnline,
      reconnectVersion: isOnline && wasOfflineBeforeUpdate
        ? this.snapshot.reconnectVersion + 1
        : this.snapshot.reconnectVersion,
    };
    this.notify();
  },

  notify() {
    this.listeners.forEach((callback) => callback());
  },
};

// Set up global event listeners once
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    onlineStatusStore.setOnlineStatus(true);
  });

  window.addEventListener('offline', () => {
    onlineStatusStore.setOnlineStatus(false);
  });
}

/**
 * useOnlineStatus - Hook for tracking online/offline status
 *
 * Uses a shared singleton store to avoid duplicate event listeners.
 * All components using this hook share the same underlying listener.
 *
 * @returns {boolean} - Whether the browser is online
 *
 * @example
 * function ConnectionStatus() {
 *   const isOnline = useOnlineStatus();
 *   return <div>{isOnline ? 'Online' : 'Offline'}</div>;
 * }
 */
export function useOnlineStatus() {
  return useSyncExternalStore(
    (callback) => onlineStatusStore.subscribe(callback),
    () => onlineStatusStore.getIsOnlineSnapshot(),
    () => onlineStatusStore.getIsOnlineServerSnapshot()
  );
}

/**
 * useOnlineStatusWithReconnect - Hook that tracks online status and reconnection events
 *
 * Extends useOnlineStatus to also track when the connection is restored,
 * useful for showing "back online" notifications.
 *
 * @returns {Object} - { isOnline, wasOffline, showReconnected, clearReconnected }
 *
 * @example
 * function OfflineIndicator() {
 *   const { isOnline, showReconnected, clearReconnected } = useOnlineStatusWithReconnect();
 *
 *   useEffect(() => {
 *     if (showReconnected) {
 *       const timer = setTimeout(clearReconnected, 3000);
 *       return () => clearTimeout(timer);
 *     }
 *   }, [showReconnected, clearReconnected]);
 *
 *   if (showReconnected) return <div>Back online!</div>;
 *   if (!isOnline) return <div>You're offline</div>;
 *   return null;
 * }
 */
export function useOnlineStatusWithReconnect() {
  const snapshot = useSyncExternalStore(
    (callback) => onlineStatusStore.subscribe(callback),
    () => onlineStatusStore.getSnapshot(),
    () => onlineStatusStore.getServerSnapshot()
  );
  const [clearedReconnectVersion, setClearedReconnectVersion] = useState(
    () => snapshot.reconnectVersion
  );

  const hasUnclearedReconnect = snapshot.reconnectVersion > clearedReconnectVersion;
  const wasOffline = !snapshot.isOnline || hasUnclearedReconnect;
  const showReconnected = snapshot.isOnline && hasUnclearedReconnect;

  const clearReconnected = () => {
    setClearedReconnectVersion(snapshot.reconnectVersion);
  };

  return {
    isOnline: snapshot.isOnline,
    wasOffline,
    showReconnected,
    clearReconnected,
  };
}
