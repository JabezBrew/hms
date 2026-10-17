import { useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { factorApi } from './api';
import { browserCeremony } from './ceremony';
import { authFailure } from './model';

export function FactorLogin() {
  const { pendingFactor, completeFactorLogin, cancelPendingLogin } = useAuth();
  const navigate = useNavigate(); const [busy, setBusy] = useState(false); const [error, setError] = useState(null);
  const [code, setCode] = useState(''); const [bootstrap, setBootstrap] = useState(''); const [expired, setExpired] = useState(false);
  const operation = useRef(null); const generation = useRef(0);
  useLayoutEffect(() => {
    generation.current += 1; setCode(''); setBootstrap(''); setError(null); setBusy(false);
    if (!pendingFactor) return undefined;
    setExpired(Date.parse(pendingFactor?.expires_at) <= Date.now());
    const timer = window.setTimeout(() => { operation.current?.abort(); setExpired(true); setBusy(false); setCode(''); setBootstrap(''); }, Math.max(0, Date.parse(pendingFactor?.expires_at) - Date.now()));
    return () => { generation.current += 1; operation.current?.abort(); operation.current = null; window.clearTimeout(timer); };
  }, [pendingFactor]);
  if (!pendingFactor) return null;
  const setup = pendingFactor.status === 'setup_required';
  const run = async (method) => {
    if (operation.current || expired) return;
    const controller = new AbortController(); const currentGeneration = generation.current; operation.current = controller; setBusy(true); setError(null);
    const active = () => !controller.signal.aborted && currentGeneration === generation.current;
    try {
      let result;
      if (method === 'recovery') result = await factorApi.recovery(pendingFactor.login_grant, code, { signal: controller.signal });
      else {
        const options = setup ? await factorApi.setupOptions(pendingFactor.login_grant, bootstrap, { signal: controller.signal }) : await factorApi.options(pendingFactor.login_grant, { signal: controller.signal });
        if (!active()) return;
        const assertion = await browserCeremony(options, { signal: controller.signal, registration: setup });
        if (!active()) return;
        result = await factorApi[setup ? 'setupVerify' : 'verify']({ login_grant: pendingFactor.login_grant, ...assertion }, { signal: controller.signal });
      }
      if (!active()) return;
      const authenticated = completeFactorLogin(result, pendingFactor.login_grant);
      if (authenticated) navigate('/');
    } catch (failure) { if (active()) setError(authFailure(failure)); }
    finally { if (operation.current === controller) operation.current = null; if (active()) { setBusy(false); setCode(''); setBootstrap(''); } }
  };
  const cancel = () => { operation.current?.abort(); setCode(''); setBootstrap(''); cancelPendingLogin(); };
  return <div className="mx-auto grid w-full max-w-md gap-5 px-5 py-6">
    <div className="space-y-2"><h1 className="font-display text-2xl font-semibold">{setup ? 'Set up trusted account access' : 'Verify your sign-in'}</h1><p className="text-sm text-muted-foreground">{setup ? 'Ask your facility administrator for a one-time setup token. After you add a passkey, use it to finish signing in.' : 'Your password was accepted. Use an existing passkey or an unused recovery code before your account opens.'}</p></div>
    {expired && <Alert variant="destructive"><AlertDescription>This request has expired. Restart sign-in to continue.</AlertDescription></Alert>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {setup ? <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); void run('setup'); }}><Label htmlFor="bootstrap-token">Operator setup token</Label><Input id="bootstrap-token" type="password" autoComplete="off" value={bootstrap} disabled={busy || expired} onChange={(event) => setBootstrap(event.target.value)} /><Button type="submit" disabled={busy || expired || !bootstrap}>{busy ? 'Waiting for passkey…' : 'Register a passkey'}</Button></form>
      : <><Button type="button" disabled={busy || expired || !pendingFactor.methods.passkey} onClick={() => run('passkey')}>{busy ? 'Verifying…' : 'Use an existing passkey'}</Button>{pendingFactor.methods.recovery_code && <form className="grid gap-3 rounded-xl border p-4" onSubmit={(event) => { event.preventDefault(); void run('recovery'); }}><Label htmlFor="recovery-code">Unused recovery code</Label><Input id="recovery-code" type="password" autoComplete="off" value={code} disabled={busy || expired} onChange={(event) => setCode(event.target.value)} /><p className="text-xs text-muted-foreground">Recovery lets you sign in. Protected actions and security changes still require a passkey.</p><Button type="submit" variant="outline" disabled={busy || expired || !code}>Use recovery code</Button></form>}</>}
    <Button type="button" variant="ghost" onClick={cancel}>Cancel and restart sign-in</Button>
  </div>;
}
