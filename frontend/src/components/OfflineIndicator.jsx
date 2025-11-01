import { useEffect, useState } from 'react';
import { WifiOff, Wifi } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';

/**
 * OfflineIndicator component
 * Displays a notification when the user loses internet connection
 * Critical for hospital environments where connectivity may be intermittent
 */
export function OfflineIndicator() {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [wasOffline, setWasOffline] = useState(false);
  const [showReconnected, setShowReconnected] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);

      // Show reconnected message if we were offline before
      if (wasOffline) {
        setShowReconnected(true);
        // Hide reconnected message after 3 seconds
        setTimeout(() => {
          setShowReconnected(false);
          setWasOffline(false);
        }, 3000);
      }
    };

    const handleOffline = () => {
      setIsOffline(true);
      setWasOffline(true);
      setShowReconnected(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [wasOffline]);

  // Show reconnected message
  if (showReconnected && !isOffline) {
    return (
      <Alert
        className={cn(
          "fixed bottom-4 right-4 w-auto max-w-sm z-50 border-green-500 bg-green-50 dark:bg-green-950",
          "animate-in slide-in-from-bottom-5 fade-in duration-300"
        )}
      >
        <Wifi className="h-4 w-4 text-green-600 dark:text-green-400" />
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
        <WifiOff className="h-4 w-4" />
        <AlertTitle>You're Offline</AlertTitle>
        <AlertDescription>
          Check your internet connection. Some features may not work properly.
        </AlertDescription>
      </Alert>
    );
  }

  return null;
}
