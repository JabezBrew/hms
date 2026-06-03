import { useCallback, useEffect, useReducer, useRef } from 'react';
import { useAuth } from '@/lib/auth';
import { getAuthValue, setAuthValue } from '@/lib/auth-storage';

const INACTIVITY_TIMEOUT = 30 * 60 * 1000;
const WARNING_TIME = 2 * 60 * 1000;
const ABSOLUTE_SESSION_TIMEOUT = 8 * 60 * 60 * 1000;
const ACTIVITY_THROTTLE_MS = 5000;
const SERVER_REFRESH_COOLDOWN_MS = WARNING_TIME;
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
const PASSIVE_ACTIVITY_EVENTS = new Set(['scroll', 'touchstart', 'wheel']);

const initialWarningState = {
  showWarning: false,
  timeLeft: 0,
  timeoutType: 'inactivity',
  isExtending: false,
};

function warningReducer(state, action) {
  switch (action.type) {
    case 'show':
      return {
        showWarning: true,
        timeoutType: action.timeoutType,
        timeLeft: action.timeLeft,
        isExtending: false,
      };
    case 'update_time_left':
      return {
        ...state,
        timeLeft: action.timeLeft,
      };
    case 'hide':
      if (!state.showWarning) {
        return state;
      }
      return {
        ...state,
        showWarning: false,
      };
    case 'begin_extend':
      return {
        ...state,
        showWarning: false,
        isExtending: true,
      };
    case 'finish_extend':
      return {
        ...state,
        showWarning: false,
        isExtending: false,
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

function getLocalIdleDeadline() {
  return getLastActivityAt() + INACTIVITY_TIMEOUT;
}

function getServerIdleDeadline() {
  return parseServerDeadline(getAuthValue('sessionIdleExpiresAt'));
}

function getIdleStatus(now = Date.now()) {
  const localDeadline = getLocalIdleDeadline();
  const serverDeadline = getServerIdleDeadline();
  const effectiveDeadline = serverDeadline
    ? Math.min(localDeadline, serverDeadline)
    : localDeadline;

  return {
    localRemaining: localDeadline - now,
    serverRemaining: serverDeadline ? serverDeadline - now : null,
    effectiveRemaining: effectiveDeadline - now,
  };
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
  const [{ showWarning, timeLeft, timeoutType, isExtending }, dispatchWarning] = useReducer(
    warningReducer,
    initialWarningState
  );

  const timeoutHandledRef = useRef(false);
  const lastActivityWriteAtRef = useRef(0);
  const serverRefreshPromiseRef = useRef(null);
  const lastServerRefreshSuccessAtRef = useRef(0);
  const mountedRef = useRef(false);
  const authGenerationRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      authGenerationRef.current += 1;
      serverRefreshPromiseRef.current = null;
    };
  }, []);

  useEffect(() => {
    authGenerationRef.current += 1;
    if (isAuthenticated) {
      timeoutHandledRef.current = false;
      return;
    }
    serverRefreshPromiseRef.current = null;
    dispatchWarning({ type: 'finish_extend' });
  }, [isAuthenticated]);

  const updateActivity = useCallback(({ force = false } = {}) => {
    const now = Date.now();
    if (now >= getLocalIdleDeadline()) {
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

  const refreshServerDeadline = useCallback(() => {
    if (!refreshAccessToken) {
      return null;
    }
    if (serverRefreshPromiseRef.current) {
      return serverRefreshPromiseRef.current;
    }

    let refreshPromise;
    refreshPromise = Promise.resolve()
      .then(() => refreshAccessToken())
      .then((token) => {
        if (token) {
          lastServerRefreshSuccessAtRef.current = Date.now();
        }
        return token;
      })
      .finally(() => {
        if (serverRefreshPromiseRef.current === refreshPromise) {
          serverRefreshPromiseRef.current = null;
        }
      });
    serverRefreshPromiseRef.current = refreshPromise;
    return refreshPromise;
  }, [refreshAccessToken]);

  const handleExtendSession = useCallback(async () => {
    if (!updateActivity({ force: true })) {
      handleTimeout();
      return;
    }
    dispatchWarning({ type: 'begin_extend' });
    const refreshGeneration = authGenerationRef.current;
    let token = null;
    try {
      token = await refreshServerDeadline();
    } catch {
      if (!mountedRef.current || authGenerationRef.current !== refreshGeneration) {
        return;
      }
      dispatchWarning({ type: 'finish_extend' });
      handleTimeout();
      return;
    }
    if (!mountedRef.current || authGenerationRef.current !== refreshGeneration) {
      return;
    }
    if (token) {
      dispatchWarning({ type: 'finish_extend' });
      return;
    }
    dispatchWarning({ type: 'finish_extend' });
    if (isSessionValid()) {
      handleTimeout();
    }
  }, [handleTimeout, isSessionValid, refreshServerDeadline, updateActivity]);

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
      if (getIdleStatus().localRemaining > WARNING_TIME) {
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
      const {
        localRemaining,
        serverRemaining,
        effectiveRemaining,
      } = getIdleStatus(now);
      const absoluteRemaining = getAbsoluteDeadline() - now;
      const recentlyRefreshedServerDeadline =
        now - lastServerRefreshSuccessAtRef.current < SERVER_REFRESH_COOLDOWN_MS;

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

      if (localRemaining <= 0) {
        handleTimeout();
        return;
      }

      if (localRemaining <= WARNING_TIME) {
        if (effectiveRemaining <= 0) {
          handleTimeout();
          return;
        }
        dispatchWarning({
          type: 'show',
          timeoutType: 'inactivity',
          timeLeft: secondsFromMilliseconds(effectiveRemaining),
        });
        return;
      }

      if (serverRemaining !== null && serverRemaining <= 0) {
        handleTimeout();
        return;
      }

      if (serverRefreshPromiseRef.current) {
        if (showWarning) {
          dispatchWarning({ type: 'hide' });
        }
        return;
      }

      if (serverRemaining !== null && serverRemaining <= WARNING_TIME) {
        if (recentlyRefreshedServerDeadline) {
          if (showWarning) {
            dispatchWarning({ type: 'hide' });
          }
          return;
        }

        const refreshPromise = refreshServerDeadline();
        if (!refreshPromise) {
          if (serverRemaining <= 0) {
            handleTimeout();
            return;
          }
          dispatchWarning({
            type: 'show',
            timeoutType: 'inactivity',
            timeLeft: secondsFromMilliseconds(serverRemaining),
          });
          return;
        }

        if (showWarning) {
          dispatchWarning({ type: 'hide' });
        }
        const refreshGeneration = authGenerationRef.current;
        refreshPromise.then(
          (token) => {
            if (!mountedRef.current || authGenerationRef.current !== refreshGeneration) {
              return;
            }
            if (!token) {
              handleTimeout();
            }
          },
          () => {
            if (!mountedRef.current || authGenerationRef.current !== refreshGeneration) {
              return;
            }
            handleTimeout();
          }
        );
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
  }, [isAuthenticated, handleTimeout, refreshServerDeadline, showWarning, isSessionValid]);

  useEffect(() => {
    if (!showWarning) return;

    const timer = setInterval(() => {
      const now = Date.now();
      const remaining = timeoutType === 'absolute'
        ? getAbsoluteDeadline() - now
        : getIdleStatus(now).effectiveRemaining;

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
    isExtending,
    handleExtendSession,
    handleTimeout,
    handleOpenChange,
  };
}
