import { useCallback, useEffect, useReducer, useRef } from 'react';
import { useAuth } from '@/lib/auth';
import { getAuthValue } from '@/lib/auth-storage';

const INACTIVITY_TIMEOUT = 30 * 60 * 1000;
const WARNING_TIME = 2 * 60 * 1000;
const ABSOLUTE_SESSION_TIMEOUT = 8 * 60 * 60 * 1000;
const ACTIVITY_THROTTLE_MS = 5000;
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
const PASSIVE_ACTIVITY_EVENTS = new Set(['scroll', 'touchstart', 'wheel']);

const initialWarningState = {
  showWarning: false,
  timeLeft: 0,
  timeoutType: 'inactivity',
};

function warningReducer(state, action) {
  switch (action.type) {
    case 'show':
      return {
        showWarning: true,
        timeoutType: action.timeoutType,
        timeLeft: action.timeLeft,
      };
    case 'update_time_left':
      return {
        ...state,
        timeLeft: action.timeLeft,
      };
    case 'hide':
      return {
        ...state,
        showWarning: false,
      };
    default:
      return state;
  }
}

function getSessionStartTime() {
  const sessionStart = getAuthValue('sessionStartTime');
  return sessionStart ? Number.parseInt(sessionStart, 10) : Date.now();
}

function secondsFromMilliseconds(milliseconds) {
  return Math.floor(milliseconds / 1000);
}

export function useSessionTimeoutWarning() {
  const { isAuthenticated, logout, isSessionValid } = useAuth();
  const [{ showWarning, timeLeft, timeoutType }, dispatchWarning] = useReducer(
    warningReducer,
    initialWarningState
  );

  const lastActivityRef = useRef(Date.now());
  const lastActivityUpdateRef = useRef(Date.now());
  const updateActivityRef = useRef(null);
  const timeoutHandledRef = useRef(false);

  const updateActivity = useCallback(() => {
    const now = Date.now();
    if (now - lastActivityUpdateRef.current < ACTIVITY_THROTTLE_MS && !showWarning) {
      return;
    }
    lastActivityUpdateRef.current = now;
    lastActivityRef.current = now;
    dispatchWarning({ type: 'hide' });
  }, [showWarning]);
  updateActivityRef.current = updateActivity;

  const handleExtendSession = useCallback(() => {
    updateActivity();
    dispatchWarning({ type: 'hide' });
  }, [updateActivity]);

  const handleTimeout = useCallback(() => {
    if (timeoutHandledRef.current) {
      return;
    }
    timeoutHandledRef.current = true;
    dispatchWarning({ type: 'hide' });
    void logout(false);
  }, [logout]);

  const handleOpenChange = useCallback((open) => {
    if (!open) {
      dispatchWarning({ type: 'hide' });
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;

    const handleActivity = () => updateActivityRef.current?.();

    ACTIVITY_EVENTS.forEach((event) => {
      const options = PASSIVE_ACTIVITY_EVENTS.has(event) ? { passive: true } : undefined;
      window.addEventListener(event, handleActivity, options);
    });

    return () => {
      ACTIVITY_EVENTS.forEach((event) => {
        const options = PASSIVE_ACTIVITY_EVENTS.has(event) ? { passive: true } : undefined;
        window.removeEventListener(event, handleActivity, options);
      });
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const evaluateTimeout = () => {
      const now = Date.now();
      const timeSinceActivity = now - lastActivityRef.current;
      const totalSessionTime = now - getSessionStartTime();

      if (totalSessionTime >= ABSOLUTE_SESSION_TIMEOUT) {
        handleTimeout();
        return;
      }

      if (totalSessionTime >= ABSOLUTE_SESSION_TIMEOUT - WARNING_TIME && !showWarning) {
        dispatchWarning({
          type: 'show',
          timeoutType: 'absolute',
          timeLeft: secondsFromMilliseconds(ABSOLUTE_SESSION_TIMEOUT - totalSessionTime),
        });
        return;
      }

      if (timeSinceActivity >= INACTIVITY_TIMEOUT - WARNING_TIME && timeSinceActivity < INACTIVITY_TIMEOUT) {
        dispatchWarning({
          type: 'show',
          timeoutType: 'inactivity',
          timeLeft: secondsFromMilliseconds(INACTIVITY_TIMEOUT - timeSinceActivity),
        });
      }

      if (timeSinceActivity >= INACTIVITY_TIMEOUT) {
        handleTimeout();
        return;
      }

      if (!isSessionValid()) {
        handleTimeout();
      }
    };

    evaluateTimeout();

    const checkTimeout = setInterval(evaluateTimeout, showWarning ? 1000 : 30000);

    return () => clearInterval(checkTimeout);
  }, [isAuthenticated, handleTimeout, showWarning, isSessionValid]);

  useEffect(() => {
    if (!showWarning) return;

    const timer = setInterval(() => {
      const now = Date.now();
      const totalSessionTime = now - getSessionStartTime();
      const timeSinceActivity = now - lastActivityRef.current;
      const remaining = timeoutType === 'absolute'
        ? ABSOLUTE_SESSION_TIMEOUT - totalSessionTime
        : INACTIVITY_TIMEOUT - timeSinceActivity;

      if (remaining > 0) {
        dispatchWarning({ type: 'update_time_left', timeLeft: secondsFromMilliseconds(remaining) });
      } else {
        handleTimeout();
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [showWarning, timeoutType, handleTimeout]);

  return {
    isAuthenticated,
    showWarning,
    timeLeft,
    timeoutType,
    handleExtendSession,
    handleTimeout,
    handleOpenChange,
  };
}
