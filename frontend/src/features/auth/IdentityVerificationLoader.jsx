import { useEffect, useState, useSyncExternalStore } from 'react';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { dismissFactorRequirement, getFactorRequirement, subscribeFactorRequirement } from '@/shared/lib/factorRequiredSignal';
import { useAuthScope } from './useAuthScope';

const loadNotice = () => import('./IdentityVerificationNotice');

// Optional verification UI must not load on startup or take a clinical draft
// through the app error boundary if its chunk cannot be downloaded.
export function IdentityVerificationLoader({ load = loadNotice }) {
  const { user } = useAuth();
  const scope = useAuthScope(user);
  const request = useSyncExternalStore(subscribeFactorRequirement, getFactorRequirement, () => null);
  const current = Boolean(user && request === scope);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!current) return undefined;
    let active = true;
    setState({ scope, Component: null, failed: false });
    Promise.resolve().then(load).then((module) => {
      if (typeof module.IdentityVerificationNotice !== 'function') throw new Error('Verification UI unavailable');
      if (active) setState({ scope, Component: module.IdentityVerificationNotice, failed: false });
    }).catch(() => { if (active) setState({ scope, Component: null, failed: true }); });
    return () => { active = false; };
  }, [attempt, current, load, scope]);
  if (!current) return null;
  if (state?.scope === scope && state.Component) { const Component = state.Component; return <Component />; }
  const failed = state?.scope === scope && state.failed;
  return <aside role={failed ? 'alert' : 'status'} className="mx-auto my-3 max-w-3xl rounded-xl border bg-card p-4 text-sm">
    <p>{failed ? 'Identity verification could not be loaded. Your open workflow has been kept. Check the connection and try again.' : 'Loading identity verification…'}</p>
    <div className="mt-3 flex gap-3">{failed && <Button type="button" variant="outline" onClick={() => setAttempt((value) => value + 1)}>Retry loading verification</Button>}<Button type="button" variant="ghost" onClick={dismissFactorRequirement}>Dismiss</Button></div>
  </aside>;
}
