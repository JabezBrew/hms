import WifiOff from 'lucide-react/dist/esm/icons/wifi-off.js';
import Wifi from 'lucide-react/dist/esm/icons/wifi.js';
import { useEffect } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { useOnlineStatusWithReconnect } from '@/hooks/useOnlineStatus';

/**
 * OfflineIndicator component
 * Displays a notification when the user loses internet connection
 * Critical for hospital environments where connectivity may be intermittent
 * Uses shared online status listener to avoid duplicate event handlers.
 */
export function OfflineIndicator() {
  const { isOnline, showReconnected, clearReconnected } = useOnlineStatusWithReconnect();

  // Hide reconnected message after 3 seconds
  useEffect(() => {
    if (showReconnected) {
      const timer = setTimeout(clearReconnected, 3000);
      return () => clearTimeout(timer);
    }
  }, [showReconnected, clearReconnected]);

  const isOffline = !isOnline;

  // Show reconnected message
  if (showReconnected && !isOffline) {
    return (
      <Alert
        className={cn(
          "fixed bottom-4 right-4 w-auto max-w-sm z-50 border-green-500 bg-green-50 dark:bg-green-950",
          "animate-in slide-in-from-bottom-5 fade-in duration-300"
        )}
      >
        <Wifi className="size-4 text-green-600 dark:text-green-400" />
        <AlertTitle className="text-green-800 dark:text-green-200">
          Back Online
        </AlertTitle>
        <AlertDescription className="text-green-700 dark:text-green-300">
          Your connection has been restored.
        </AlertDescription>
      </Alert>
    );
  }

  // Show offline message
  if (isOffline) {
    return (
      <Alert
        variant="destructive"
        className={cn(
          "fixed bottom-4 right-4 w-auto max-w-sm z-50",
          "animate-in slide-in-from-bottom-5 fade-in duration-300"
        )}
      >
        <WifiOff className="size-4" />
        <AlertTitle>You're Offline</AlertTitle>
        <AlertDescription>
          Check your internet connection. Some features may not work properly.
        </AlertDescription>
      </Alert>
    );
  }

  return null;
}
