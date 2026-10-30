import { lazy } from 'react';
import { Button } from '@/components/ui/button';
function AuthSessionUnavailable() {
  return <main className="grid min-h-dvh place-content-center gap-4 bg-background p-6 text-center"><h1 className="text-lg font-semibold">Sign-in is temporarily unavailable</h1><p role="alert" className="text-sm text-muted-foreground">HMS could not load the session service. Check your connection and reload to try again.</p><Button type="button" variant="outline" onClick={() => window.location.reload()}>Reload HMS</Button></main>;
}
// Called once at module scope by the host. Tests use the same module-load path.
export function authSessionRuntime(load) {
  return lazy(() => load().then(module => {
    if (typeof module?.default !== 'function') throw new Error('Session module unavailable');
    return module;
  }).catch(() => ({ default: AuthSessionUnavailable })));
}
