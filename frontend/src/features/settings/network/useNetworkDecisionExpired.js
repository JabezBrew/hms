import { networkClockCurrent } from '@/lib/api/v2/networkAccessGuard';
import { serverClock } from '@/shared/lib/serverClock';
import { useCallback, useSyncExternalStore } from 'react';

export function useNetworkDecisionExpired(decision) {
  const remaining = useCallback(() => { const clock = serverClock(decision); return clock ? Math.min(clock.tokenRemaining(), decision?.classification === 'offsite' && decision.mode === 'fresh_reauth' ? clock.remaining(decision.reauth_expires_at) : Infinity) : 0; }, [decision]);
  const subscribe = useCallback((notify) => {
    if (!decision) return () => {};
    const budget = remaining();
    const timer = budget > 0 ? window.setTimeout(notify, Math.min(budget, 2147483647)) : null;
    window.addEventListener('focus', notify); document.addEventListener('visibilitychange', notify);
    return () => { if (timer !== null) window.clearTimeout(timer); window.removeEventListener('focus', notify); document.removeEventListener('visibilitychange', notify); };
  }, [decision, remaining]);
  const snapshot = useCallback(() => Boolean(decision?.access_allowed === true && !networkClockCurrent(decision)), [decision]);
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
export function restrictExpiredDecision(decision, expired) {
  return expired && decision ? { ...decision, read_only: true, access_allowed: false, reauth_required: true, reason: 'reauth_required' } : decision;
}
