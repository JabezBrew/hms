import { createElement, useMemo } from 'react';
import { ReadOnlyModeProvider } from '@/contexts/ReadOnlyModeContext';
import { bindNetworkAccessGuard } from '@/lib/api/v2/networkAccessGuard';
import { bindServerClock, clockNow } from '@/shared/lib/serverClock';
// Explicit UNIT precondition only. No server source, auth witness, receipt,
// readReviews stamp or authority is created here. Production never imports it.
// Actual clock/provider/SDK controls do not use this model.
export function modelNetworkBudget(value, windowMs = 600000) {
  if (!value || !Number.isFinite(windowMs) || windowMs <= 0 || windowMs > 900000) throw new Error('Invalid modeled network budget');
  const copy = { ...value }; const started = clockNow(); const database = Date.now();
  const remaining = budget => { const elapsed = clockNow() - started; return Number.isFinite(elapsed) && elapsed >= 0 ? Math.max(0, Math.floor(budget - elapsed)) : 0; };
  bindServerClock(copy, Object.freeze({ tokenRemaining: () => remaining(windowMs), remaining: deadline => {
    const budget = Date.parse(deadline) - database;
    return Number.isFinite(budget) ? remaining(Math.min(windowMs, budget)) : 0;
  } }));
  return copy;
}
export function bindModeledNetworkGuard(context) {
  const binding = bindNetworkAccessGuard(context);
  return { ...binding, update(snapshot) { return binding.update({ ...snapshot, decision: snapshot.decision ? modelNetworkBudget(snapshot.decision) : snapshot.decision }); } };
}

// Isolated legacy unit suites explicitly supply modeled time preconditions.
// Keep every actual provider flag and domain decision unchanged. The same
// supplied observation retains its original finite anchor across rerenders.
export function ModeledReadOnlyModeProvider({ children, network, windowMs = 600000 }) {
  const decision = network?.decision;
  const modeled = useMemo(() => decision ? modelNetworkBudget(decision, windowMs) : decision, [decision, windowMs]);
  const value = useMemo(() => network ? { ...network, decision: modeled } : network, [network, modeled]);
  return createElement(ReadOnlyModeProvider, { network: value }, children);
}
