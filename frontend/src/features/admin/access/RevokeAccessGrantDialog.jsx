import { useId, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useRevokeAccessGrant } from './useAdminAccess';

export function RevokeAccessGrantDialog({ grant, user, reauthenticate, onClose, onRefresh }) {
  const id = useId();
  const [password, setPassword] = useState('');
  const [reconciliation, setReconciliation] = useState('');
  const action = useRevokeAccessGrant({ grant, user, reauthenticate });
  const close = () => { if (!action.busy) { setPassword(''); onClose(); } };
  const submit = async (event) => {
    event.preventDefault();
    if (grant.reconciliation_required && !reconciliation) return;
    try { await action.submit({ password, reconciliation: reconciliation || undefined }); }
    finally { setPassword(''); }
  };
  return <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
      <DialogHeader><DialogTitle>{action.saved ? 'Grant revoked' : 'Revoke access grant'}</DialogTitle>
        <DialogDescription>{grant.display_name} · {grant.permission_code || grant.position_title || 'Authority appointment'}. The original grant and audit history are retained.</DialogDescription>
      </DialogHeader>
      {action.saved ? <>
        <Alert role="status"><AlertTitle>Revocation confirmed</AlertTitle><AlertDescription>
          <p>This grant is revoked. The staff member must sign in again for their updated permissions.</p>
          {action.saved.independent_access_retained ? <p>Independent direct access to this permission was retained.</p> : null}
          {action.saved.effective_permission_remaining === true ? <p>This permission is still available through another valid source.</p> : action.saved.effective_permission_remaining === false ? <p>No effective facility-wide access to this permission remains.</p> : <p>Other appointments or independently assigned permissions may still provide access.</p>}
          {action.refreshFailed ? <p>The grant list could not refresh. This confirmed revocation is saved; refresh the list when available.</p> : null}
        </AlertDescription></Alert>
        <DialogFooter><Button type="button" onClick={close}>Done</Button></DialogFooter>
      </> : <form onSubmit={submit} className="grid gap-5">
        {grant.reconciliation_required && <fieldset disabled={action.busy || action.unconfirmed} className="grid gap-3 rounded-xl border p-4">
          <legend className="px-1 text-sm font-medium">Review historical permission</legend>
          <p className="text-sm text-muted-foreground">An earlier grant copied this permission into direct access. Its original ownership is unknown. Choose what should remain after revoking the grant. This decision applies to this staff member and permission.</p>
          <RadioGroup value={reconciliation} onValueChange={setReconciliation} aria-label="Historical permission decision">
            <div className="flex items-start gap-3"><RadioGroupItem id={`${id}-retain`} value="retain_independent" /><Label htmlFor={`${id}-retain`} className="grid gap-1 leading-relaxed">Retain independent access<span className="font-normal text-muted-foreground">Keep the direct permission. Revoking this grant will not remove that access.</span></Label></div>
            <div className="flex items-start gap-3"><RadioGroupItem id={`${id}-remove`} value="remove_historical_copy" /><Label htmlFor={`${id}-remove`} className="grid gap-1 leading-relaxed">Remove the historical copy<span className="font-normal text-muted-foreground">Remove this direct permission. Other active grants remain effective.</span></Label></div>
          </RadioGroup>
        </fieldset>}
        {!grant.reconciliation_required && <p className="text-sm text-muted-foreground">Other active grants and independently assigned permissions are preserved.</p>}
        <div className="grid gap-2"><Label htmlFor={`${id}-password`}>Confirm your current password</Label><Input id={`${id}-password`} type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={action.busy} required /><p className="text-xs text-muted-foreground">This confirms a fresh sign-in. Existing account security enrollment requirements also apply.</p></div>
        {action.error && <Alert variant="destructive"><AlertTitle>{action.unconfirmed ? 'Revocation status unknown' : 'Access not changed'}</AlertTitle><AlertDescription>{action.error}{action.unconfirmed && <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onRefresh}>Refresh grant list</Button>}</AlertDescription></Alert>}
        <DialogFooter><Button type="button" variant="outline" disabled={action.busy} onClick={close}>Cancel</Button><Button type="submit" variant="destructive" disabled={action.busy || !password || (grant.reconciliation_required && !reconciliation)}>{action.busy ? 'Revoking…' : action.unconfirmed ? 'Retry revocation' : 'Revoke grant'}</Button></DialogFooter>
      </form>}
    </DialogContent>
  </Dialog>;
}
