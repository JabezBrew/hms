import { useCallback, useEffect, useReducer, useRef } from 'react';
import { useAuth } from '@/lib/auth';
import { getAuthValue, setAuthValue } from '@/lib/auth-storage';

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

function getLastActivityAt() {
  const lastActivityAt = getAuthValue('lastActivityAt');
  return lastActivityAt ? Number.parseInt(lastActivityAt, 10) : getSessionStartTime();
}

function parseServerDeadline(value) {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getIdleDeadline() {
  const localIdleDeadline = getLastActivityAt() + INACTIVITY_TIMEOUT;
  const serverIdleDeadline = parseServerDeadline(getAuthValue('sessionIdleExpiresAt'));
  return serverIdleDeadline
    ? Math.min(localIdleDeadline, serverIdleDeadline)
    : localIdleDeadline;
}

function getAbsoluteDeadline() {
  return parseServerDeadline(getAuthValue('sessionAbsoluteExpiresAt'))
    || getSessionStartTime() + ABSOLUTE_SESSION_TIMEOUT;
}

function secondsFromMilliseconds(milliseconds) {
  return Math.floor(milliseconds / 1000);
}

export function useSessionTimeoutWarning() {
  const { isAuthenticated, logout, isSessionValid, refreshAccessToken } = useAuth();
  const [{ showWarning, timeLeft, timeoutType }, dispatchWarning] = useReducer(
    warningReducer,
    initialWarningState
  );

  const timeoutHandledRef = useRef(false);
  const lastActivityWriteAtRef = useRef(0);

  useEffect(() => {
    if (isAuthenticated) {
      timeoutHandledRef.current = false;
      return;
    }
    dispatchWarning({ type: 'hide' });
  }, [isAuthenticated]);

  const updateActivity = useCallback(({ force = false } = {}) => {
    const now = Date.now();
    if (now >= getIdleDeadline()) {
      return false;
    }
    if (!force && now - lastActivityWriteAtRef.current < ACTIVITY_THROTTLE_MS) {
      return true;
    }
    lastActivityWriteAtRef.current = now;
    setAuthValue('lastActivityAt', now.toString());
    return true;
  }, []);

  const handleTimeout = useCallback(() => {
    if (timeoutHandledRef.current) {
      return;
    }
    timeoutHandledRef.current = true;
    dispatchWarning({ type: 'hide' });
    void logout(false);
  }, [logout]);

  const handleExtendSession = useCallback(async () => {
    if (!updateActivity({ force: true })) {
      handleTimeout();
      return;
    }
    const token = await refreshAccessToken?.();
    if (token) {
      dispatchWarning({ type: 'hide' });
      return;
    }
    dispatchWarning({ type: 'hide' });
  }, [handleTimeout, refreshAccessToken, updateActivity]);

  const handleOpenChange = useCallback((open) => {
    if (!open) {
      dispatchWarning({ type: 'hide' });
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;

    const handleActivity = () => {
      if (!updateActivity()) {
        handleTimeout();
        return;
      }
      if (getIdleDeadline() - Date.now() > WARNING_TIME) {
        dispatchWarning({ type: 'hide' });
      }
    };

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
  }, [handleTimeout, isAuthenticated, updateActivity]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const evaluateTimeout = () => {
      const now = Date.now();
      const idleRemaining = getIdleDeadline() - now;
      const absoluteRemaining = getAbsoluteDeadline() - now;

      if (absoluteRemaining <= 0) {
        handleTimeout();
        return;
      }

      if (absoluteRemaining <= WARNING_TIME) {
        dispatchWarning({
          type: 'show',
          timeoutType: 'absolute',
          timeLeft: secondsFromMilliseconds(absoluteRemaining),
        });
        return;
      }

      if (idleRemaining <= 0) {
        handleTimeout();
        return;
      }

      if (idleRemaining <= WARNING_TIME) {
        dispatchWarning({
          type: 'show',
          timeoutType: 'inactivity',
          timeLeft: secondsFromMilliseconds(idleRemaining),
        });
        return;
      }

      if (showWarning) {
        dispatchWarning({ type: 'hide' });
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
      const remaining = timeoutType === 'absolute'
        ? getAbsoluteDeadline() - now
        : getIdleDeadline() - now;

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
