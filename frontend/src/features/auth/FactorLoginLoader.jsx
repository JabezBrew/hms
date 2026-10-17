import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';

const loadFactorLogin = () => import('./FactorLogin');

export function FactorLoginLoader({ load = loadFactorLogin }) {
  const { pendingFactor, cancelPendingLogin } = useAuth();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!pendingFactor) return undefined;
    let active = true;
    setState({ pendingFactor, Component: null, failed: false });
    Promise.resolve().then(load).then((module) => {
      if (typeof module.FactorLogin !== 'function') throw new Error('Sign-in UI unavailable');
      if (active) setState({ pendingFactor, Component: module.FactorLogin, failed: false });
    }).catch(() => { if (active) setState({ pendingFactor, Component: null, failed: true }); });
    return () => { active = false; };
  }, [attempt, load, pendingFactor]);
  if (!pendingFactor) return null;
  if (state?.pendingFactor === pendingFactor && state.Component) { const Component = state.Component; return <Component />; }
  const failed = state?.pendingFactor === pendingFactor && state.failed;
  return <div role={failed ? 'alert' : 'status'} className="mx-auto grid w-full max-w-md gap-4 px-5 py-6">
    <p>{failed ? 'Sign-in verification could not be loaded. Your account has not opened. Check the connection and try again, or restart sign-in.' : 'Loading sign-in verification…'}</p>
    {failed && <Button type="button" variant="outline" onClick={() => setAttempt((value) => value + 1)}>Retry loading sign-in verification</Button>}
    <Button type="button" variant="ghost" onClick={cancelPendingLogin}>Cancel and restart sign-in</Button>
  </div>;
}
