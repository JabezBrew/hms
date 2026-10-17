import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useAuth } from '@/lib/auth';
import { useAuthScope } from './useAuthScope';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { dismissFactorRequirement, getFactorRequirement, subscribeFactorRequirement } from '@/shared/lib/factorRequiredSignal';
import { authFailure } from './model';

export function IdentityVerificationNotice() {
  const { user, reauthenticate } = useAuth(); const request = useSyncExternalStore(subscribeFactorRequirement, getFactorRequirement, () => null);
  const scope = useAuthScope(user);
  const [open, setOpen] = useState(false); const [password, setPassword] = useState(''); const [error, setError] = useState(null); const [busy, setBusy] = useState(false); const operation = useRef(null);
  useLayoutEffect(() => {
    setOpen(false); setPassword(''); setError(null); setBusy(false);
    return () => { operation.current?.abort(); operation.current = null; };
  }, [scope]);
  const current = user && request === scope;
  if (!current) return null;
  const close = () => { if (!operation.current) { setOpen(false); setPassword(''); } };
  const verify = async (event) => {
    event.preventDefault(); if (operation.current || !reauthenticate) return;
    const controller = new AbortController(); operation.current = controller; setBusy(true); setError(null);
    try { await reauthenticate(user.email, password || undefined, user.facilityCode, { signal: controller.signal }); if (!controller.signal.aborted) dismissFactorRequirement(); }
    catch (failure) { if (!controller.signal.aborted) setError(authFailure(failure)); }
    finally { if (operation.current === controller) operation.current = null; if (!controller.signal.aborted) { setBusy(false); setPassword(''); } }
  };
  return <><Alert className="mx-auto my-3 max-w-3xl"><AlertTitle>Verify identity before continuing</AlertTitle><AlertDescription><p>The server requires fresh proof for a protected action. After verification, reload and review that workflow before explicitly submitting again. No action will retry automatically.</p><div className="mt-2 flex gap-2"><Button type="button" onClick={() => setOpen(true)}>Verify identity</Button><Button type="button" variant="ghost" onClick={dismissFactorRequirement}>Dismiss</Button></div></AlertDescription></Alert>
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}><DialogContent><DialogHeader><DialogTitle>Verify current identity</DialogTitle><DialogDescription>Use an existing passkey. Enter your password too if its confirmation has expired. This does not grant patient access or override network policy.</DialogDescription></DialogHeader><form onSubmit={verify} className="grid gap-4"><Label htmlFor="identity-proof-password">Current password (if required)</Label><Input id="identity-proof-password" type="password" autoComplete="current-password" value={password} disabled={busy} onChange={(event) => setPassword(event.target.value)} />{error && <p role="alert">{error}</p>}<DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={close}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Verifying…' : 'Use passkey'}</Button></DialogFooter></form></DialogContent></Dialog></>;
}
