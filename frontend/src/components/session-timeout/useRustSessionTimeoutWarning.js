import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { clockNow } from '@/shared/lib/serverClock';
const WARNING = 120000;
export function useRustSessionTimeoutWarning(enabled) {
  const { isAuthenticated: signedIn, logout, refreshAccessToken, getSessionBudget } = useAuth();
  const isAuthenticated = enabled && signedIn;
  const [state, setState] = useState({ showWarning: false, timeLeft: 0, timeoutType: 'inactivity', isExtending: false });
  const life = useRef({ active: false, pending: null, lastAttempt: -Infinity, expired: false, generation: 0 });
  useEffect(() => { const current = life.current; current.active = isAuthenticated; current.generation += 1; current.expired = false; return () => { current.active = false; current.generation += 1; }; }, [isAuthenticated]);
  const handleTimeout = useCallback(() => {
    if (!life.current.active || life.current.expired) return;
    life.current.expired = true; setState(value => ({ ...value, showWarning: false })); void logout(false);
  }, [logout]);
  const refresh = useCallback(async () => {
    if (!life.current.active) return null;
    if (life.current.pending) return life.current.pending;
    const generation = life.current.generation; life.current.lastAttempt = clockNow();
    const promise = Promise.resolve().then(refreshAccessToken).catch(() => null).finally(() => {
      if (life.current.pending === promise) life.current.pending = null;
      if (life.current.active && life.current.generation === generation) setState(value => ({ ...value, isExtending: false }));
    });
    life.current.pending = promise; return promise;
  }, [refreshAccessToken]);
  const handleExtendSession = useCallback(async () => {
    if (!(getSessionBudget?.().localRemaining > 0)) { handleTimeout(); return; }
    setState(value => ({ ...value, showWarning: false, isExtending: true })); await refresh();
    // Missing/stale clock or transient failure means checking, never revocation.
  }, [getSessionBudget, handleTimeout, refresh]);
  useEffect(() => {
    if (!isAuthenticated) return undefined;
    const evaluate = () => {
      const budget = getSessionBudget?.(); if (!budget) return;
      if (budget.localRemaining <= 0) { handleTimeout(); return; }
      if (budget.checking || budget.remaining <= 0) {
        setState(value => value.showWarning ? { ...value, showWarning: false } : value);
        if (!life.current.pending && clockNow() - life.current.lastAttempt >= 30000) void refresh();
        return;
      }
      const absolute = budget.absoluteRemaining; const idle = Math.min(budget.localRemaining, budget.idleRemaining);
      const remaining = Math.min(absolute, idle); const showWarning = remaining <= WARNING;
      setState(value => ({ ...value, showWarning, timeoutType: absolute <= idle ? 'absolute' : 'inactivity', timeLeft: Math.max(0, Math.floor(remaining / 1000)) }));
      if (budget.localRemaining > WARNING && budget.absoluteRemaining > WARNING && budget.idleRemaining <= WARNING && clockNow() - life.current.lastAttempt >= WARNING) void refresh();
    };
    evaluate(); const timer = window.setInterval(evaluate, 1000);
    window.addEventListener('focus', evaluate); document.addEventListener('visibilitychange', evaluate);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', evaluate); document.removeEventListener('visibilitychange', evaluate); };
  }, [isAuthenticated, getSessionBudget, handleTimeout, refresh]);
  const handleOpenChange = useCallback(open => { if (!open) setState(value => ({ ...value, showWarning: false })); }, []);
  return { isAuthenticated, ...state, handleExtendSession, handleTimeout, handleOpenChange };
}
