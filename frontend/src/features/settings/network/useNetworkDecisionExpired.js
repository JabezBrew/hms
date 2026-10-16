import { useCallback, useSyncExternalStore } from 'react';

export function useNetworkDecisionExpired(decision) {
  const deadline = decision?.classification === 'offsite' && decision.mode === 'fresh_reauth' && decision.access_allowed && !decision.read_only
    ? Date.parse(decision.reauth_expires_at) : null;
  const subscribe = useCallback((notify) => {
    if (!Number.isFinite(deadline)) return () => {};
    const remaining = deadline - Date.now();
    const timer = remaining > 0 ? window.setTimeout(notify, Math.min(remaining, 2147483647)) : null;
    window.addEventListener('focus', notify); document.addEventListener('visibilitychange', notify);
    return () => { if (timer !== null) window.clearTimeout(timer); window.removeEventListener('focus', notify); document.removeEventListener('visibilitychange', notify); };
  }, [deadline]);
  const snapshot = useCallback(() => Number.isFinite(deadline) && Date.now() >= deadline, [deadline]);
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
export function restrictExpiredDecision(decision, expired) {
  return expired && decision ? { ...decision, read_only: true, access_allowed: false, reauth_required: true, reason: 'reauth_required' } : decision;
}
