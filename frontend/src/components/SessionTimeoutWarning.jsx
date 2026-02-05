import Clock from 'lucide-react/dist/esm/icons/clock.js';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useAuth } from '@/lib/auth';
import { getAuthValue } from '@/lib/auth-storage';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/**
 * SessionTimeoutWarning component
 * Warns users before their session expires and offers to extend it
 * Prevents data loss and improves security UX
 */
export function SessionTimeoutWarning() {
  const { isAuthenticated, logout, isSessionValid } = useAuth();
  const [showWarning, setShowWarning] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const [timeoutType, setTimeoutType] = useState('inactivity'); // 'inactivity' or 'absolute'

  // Session timeout configuration (in milliseconds)
  const INACTIVITY_TIMEOUT = 30 * 60 * 1000; // 30 minutes
  const WARNING_TIME = 2 * 60 * 1000; // Show warning 2 minutes before timeout
  const ABSOLUTE_SESSION_TIMEOUT = 8 * 60 * 60 * 1000; // 8 hours

  // Activity tracking
  const [lastActivity, setLastActivity] = useState(Date.now());
  const lastActivityUpdateRef = useRef(Date.now());

  // Get session start time from local storage
  const getSessionStartTime = () => {
    const sessionStart = getAuthValue("sessionStartTime");
    return sessionStart ? parseInt(sessionStart, 10) : Date.now();
  };

  // Track user activity
  const updateActivity = useCallback(() => {
    const now = Date.now();
    // Throttle high-frequency events (e.g., scroll) to reduce render churn.
    if (now - lastActivityUpdateRef.current < 5000 && !showWarning) {
      return;
    }
    lastActivityUpdateRef.current = now;
    setLastActivity(now);
    setShowWarning(false);
  }, [showWarning]);

  // Handle user extending session
  const handleExtendSession = useCallback(() => {
    updateActivity();
    setShowWarning(false);
  }, [updateActivity]);

  // Handle session timeout - notify backend to revoke the session
  const handleTimeout = useCallback(() => {
    setShowWarning(false);
    // Try to notify backend even if token may be expired - backend logout
    // endpoint allows unauthenticated calls and will use the refresh cookie
    logout(false);
  }, [logout]);

  // Setup activity listeners
  useEffect(() => {
    if (!isAuthenticated) return;

    const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    // Events that benefit from passive listeners for better scroll performance
    const passiveEvents = ['scroll', 'touchstart', 'wheel'];

    events.forEach((event) => {
      const options = passiveEvents.includes(event) ? { passive: true } : undefined;
      window.addEventListener(event, updateActivity, options);
    });

    return () => {
      events.forEach((event) => {
        const options = passiveEvents.includes(event) ? { passive: true } : undefined;
        window.removeEventListener(event, updateActivity, options);
      });
    };
  }, [isAuthenticated, updateActivity]);

  // Check for timeout
  useEffect(() => {
    if (!isAuthenticated) return;

    const checkTimeout = setInterval(() => {
      const now = Date.now();
      const timeSinceActivity = now - lastActivity;
      const sessionStartTime = getSessionStartTime();
      const totalSessionTime = now - sessionStartTime;

      // Check absolute session timeout first
      if (totalSessionTime >= ABSOLUTE_SESSION_TIMEOUT) {
        handleTimeout();
        return;
      }

      // Check if approaching absolute timeout
      if (totalSessionTime >= ABSOLUTE_SESSION_TIMEOUT - WARNING_TIME && !showWarning) {
        setTimeoutType('absolute');
        setShowWarning(true);
        const remaining = ABSOLUTE_SESSION_TIMEOUT - totalSessionTime;
        setTimeLeft(Math.floor(remaining / 1000));
        return;
      }

      // Check inactivity timeout
      if (timeSinceActivity >= INACTIVITY_TIMEOUT - WARNING_TIME && timeSinceActivity < INACTIVITY_TIMEOUT) {
        if (!showWarning || timeoutType !== 'inactivity') {
          setTimeoutType('inactivity');
          setShowWarning(true);
        }
        const remaining = INACTIVITY_TIMEOUT - timeSinceActivity;
        setTimeLeft(Math.floor(remaining / 1000));
      }

      // Logout if inactivity timeout exceeded
      if (timeSinceActivity >= INACTIVITY_TIMEOUT) {
        handleTimeout();
      }

      // Also periodically check if session is still valid (token expiration)
      if (!isSessionValid()) {
        handleTimeout();
      }
    }, showWarning ? 1000 : 30000);

    return () => clearInterval(checkTimeout);
  }, [isAuthenticated, lastActivity, handleTimeout, showWarning, timeoutType, isSessionValid, INACTIVITY_TIMEOUT, ABSOLUTE_SESSION_TIMEOUT, WARNING_TIME]);

  // Update countdown timer
  useEffect(() => {
    if (!showWarning) return;

    const timer = setInterval(() => {
      const now = Date.now();
      const sessionStartTime = getSessionStartTime();
      const totalSessionTime = now - sessionStartTime;
      const timeSinceActivity = now - lastActivity;

      let remaining;
      if (timeoutType === 'absolute') {
        remaining = ABSOLUTE_SESSION_TIMEOUT - totalSessionTime;
      } else {
        remaining = INACTIVITY_TIMEOUT - timeSinceActivity;
      }

      if (remaining > 0) {
        setTimeLeft(Math.floor(remaining / 1000));
      } else {
        handleTimeout();
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [showWarning, lastActivity, timeoutType, handleTimeout, INACTIVITY_TIMEOUT, ABSOLUTE_SESSION_TIMEOUT]);

  if (!isAuthenticated) return null;

  const minutes = Math.floor(timeLeft / 60);
  const seconds = timeLeft % 60;

  const getWarningMessage = () => {
    if (timeoutType === 'absolute') {
      return {
        title: 'Maximum Session Time Reached',
        description: `For security reasons, you must re-authenticate after 8 hours. Your session will end in `,
        canExtend: false
      };
    }
    return {
      title: 'Session Expiring Soon',
      description: 'Your session will expire due to inactivity in ',
      canExtend: true
    };
  };

  const warningMessage = getWarningMessage();

  return (
    <AlertDialog open={showWarning} onOpenChange={setShowWarning}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900">
            <Clock className="h-6 w-6 text-amber-600 dark:text-amber-400" />
          </div>
          <AlertDialogTitle className="text-center">
            {warningMessage.title}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-center">
            {warningMessage.description}
            <span className="font-semibold text-amber-600 dark:text-amber-400">
              {minutes}:{seconds.toString().padStart(2, '0')}
            </span>
            .
            {warningMessage.canExtend && (
              <>
                <br />
                Would you like to continue your session?
              </>
            )}
            {!warningMessage.canExtend && (
              <>
                <br />
                Please save your work and log in again to continue.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="sm:justify-center">
          <AlertDialogCancel onClick={handleTimeout}>
            Logout Now
          </AlertDialogCancel>
          {warningMessage.canExtend && (
            <AlertDialogAction onClick={handleExtendSession}>
              Continue Session
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
