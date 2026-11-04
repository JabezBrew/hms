import { networkClockCurrent } from '@/lib/api/v2/networkAccessGuard';
import { serverClock, subscribeServerClockDenials } from '@/shared/lib/serverClock';
import { useCallback, useSyncExternalStore } from 'react';

function decisionExpiry(decision) {
  const clock = serverClock(decision);
  const deadline = decision?.classification === 'offsite' && decision.mode === 'fresh_reauth' ? decision.reauth_expires_at : undefined;
  return clock?.uiExpiry ? clock.uiExpiry(deadline) : {
    phase: networkClockCurrent(decision) ? 'current' : 'expired',
    remaining: clock ? Math.min(clock.tokenRemaining(), deadline === undefined ? Infinity : clock.remaining(deadline)) : 0,
  };
}
export const networkDecisionDenialPending = decision => decision?.access_allowed === true && decisionExpiry(decision).phase === 'denied';
export function useNetworkDecisionExpired(decision) {
  const subscribe = useCallback((notify) => {
    if (!decision) return () => {};
    const unsubscribeDenial = subscribeServerClockDenials(notify);
    const budget = decisionExpiry(decision).remaining;
    const timer = budget > 0 ? window.setTimeout(notify, Math.min(budget, 2147483647)) : null;
    window.addEventListener('focus', notify); document.addEventListener('visibilitychange', notify);
    return () => { unsubscribeDenial(); if (timer !== null) window.clearTimeout(timer); window.removeEventListener('focus', notify); document.removeEventListener('visibilitychange', notify); };
  }, [decision]);
  // A denial and later natural expiry both block access, but must notify React
  // separately so an original hidden workflow is removed at its real deadline.
  const snapshot = useCallback(() => decision?.access_allowed === true ? decisionExpiry(decision).phase : 'current', [decision]);
  return useSyncExternalStore(subscribe, snapshot, () => 'current') !== 'current';
}
export function restrictExpiredDecision(decision, expired) {
  return expired && decision ? { ...decision, read_only: true, access_allowed: false, reauth_required: true, reason: 'reauth_required' } : decision;
}
