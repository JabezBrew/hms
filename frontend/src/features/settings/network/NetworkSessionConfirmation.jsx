import { useEffect, useId, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { networkApi } from './api';
import { assertNetworkSession } from './model';

export function NetworkSessionConfirmation({ user, reauthenticate, onVerified, onClose }) {
  const id = useId(); const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(null);
  const pending = useRef(null); const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; pending.current?.abort(); }; }, []);
  const close = () => { if (!pending.current) { setPassword(''); onClose(); } };
  const submit = async (event) => {
    event.preventDefault(); if (pending.current || !password) return;
    const controller = new AbortController(); pending.current = controller; setBusy(true); setError(null);
    try {
      const authenticated = await reauthenticate(user.email, password, user.facilityCode, { signal: controller.signal });
      if (controller.signal.aborted) return;
      assertNetworkSession(user, authenticated);
      const decision = await networkApi.current({ signal: controller.signal });
      if (!controller.signal.aborted) onVerified(decision);
    } catch (value) { if (mounted.current) setError(value.message || 'The current connection could not be confirmed.'); }
    finally { pending.current = null; if (mounted.current) { setPassword(''); setBusy(false); } }
  };
  return <Dialog open onOpenChange={(open) => { if (!open) close(); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md"><DialogHeader><DialogTitle>Confirm your current sign-in</DialogTitle><DialogDescription>The server will reevaluate this connection after credential confirmation. Unknown origins and unconfigured policies remain read-only.</DialogDescription></DialogHeader>
    <form onSubmit={submit} className="grid gap-4"><div className="grid gap-2"><Label htmlFor={`${id}-password`}>Current password</Label><Input id={`${id}-password`} type="password" autoComplete="current-password" value={password} disabled={busy} onChange={(event) => setPassword(event.target.value)} /></div><p className="text-xs text-muted-foreground">Confirmation uses your password and an existing passkey. Verified factors do not override this connection’s network policy.</p>{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={close}>Cancel</Button><Button type="submit" disabled={busy || !password}>{busy ? 'Confirming…' : 'Confirm sign-in'}</Button></DialogFooter></form>
  </DialogContent></Dialog>;
}
