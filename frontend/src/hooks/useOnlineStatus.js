import { useState, useEffect, useSyncExternalStore } from 'react';

/**
 * Shared online status store using a singleton pattern.
 * This ensures only one set of event listeners exists across all components.
 */
const onlineStatusStore = {
  listeners: new Set(),
  isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,

  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  },

  getSnapshot() {
    return this.isOnline;
  },

  getServerSnapshot() {
    return true; // Assume online during SSR
  },

  notify() {
    this.listeners.forEach((callback) => callback());
  },
};

// Set up global event listeners once
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    onlineStatusStore.isOnline = true;
    onlineStatusStore.notify();
  });

  window.addEventListener('offline', () => {
    onlineStatusStore.isOnline = false;
    onlineStatusStore.notify();
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
    () => onlineStatusStore.getSnapshot(),
    () => onlineStatusStore.getServerSnapshot()
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
  const isOnline = useOnlineStatus();
  const [wasOffline, setWasOffline] = useState(false);
  const [showReconnected, setShowReconnected] = useState(false);

  useEffect(() => {
    if (!isOnline) {
      setWasOffline(true);
      setShowReconnected(false);
    } else if (wasOffline) {
      setShowReconnected(true);
    }
  }, [isOnline, wasOffline]);

  const clearReconnected = () => {
    setShowReconnected(false);
    setWasOffline(false);
  };

  return {
    isOnline,
    wasOffline,
    showReconnected,
    clearReconnected,
  };
}

export default useOnlineStatus;
