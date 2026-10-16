import { useId, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { userHasCapability } from '@/shared/lib/access';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useSeriesWrite } from './hooks';
import { formatSeriesTime } from './model';
import { SeriesMembers } from './SeriesMembers';
export function SeriesCancellationDialog({ series, open = true, onClose }) {
  const { user } = useAuth(); const canManage = userHasCapability(user, 'appointment.manage');
  const id = useId(); const [reason, setReason] = useState(''); const [requestId] = useState(() => crypto.randomUUID());
  const action = useSeriesWrite('cancel');
  const reasonTooLong = new TextEncoder().encode(reason.trim()).length > 1000;
  const close = () => { if (!action.busy) onClose({ preserve: action.unknown }); };
  const submit = () => {
    if (action.busy || action.saved || !canManage || !reason.trim() || reasonTooLong) return;
    void action.submit(series.id, { client_request_id: requestId, expected_snapshot_token: series.snapshot_token, reason: reason.trim() });
  };
  return <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
    <DialogHeader><DialogTitle>{action.saved ? 'Cancellation result saved' : 'Cancel future appointments'}</DialogTitle><DialogDescription>Only appointments that remain scheduled and start after the server's cutoff can be cancelled. Past, arrived and completed appointments are retained.</DialogDescription></DialogHeader>
    {action.saved ? <><Alert role="status"><AlertTitle>Cancellation confirmed</AlertTitle><AlertDescription>{action.saved.cancelled_count} cancelled · {action.saved.retained_appointment_ids.length} retained. Cutoff: {formatSeriesTime(action.saved.cutoff_at)}. This result does not mean every appointment in the group was cancelled.</AlertDescription></Alert><SeriesMembers series={action.saved.series} /></> : <>
      <p className="text-sm">{series.patient_display_name} · {series.clinic_name} · {series.service_name}</p>
      <div className="grid gap-2"><Label htmlFor={`${id}-reason`}>Reason for cancelling future appointments</Label><Textarea id={`${id}-reason`} maxLength={1000} value={reason} aria-invalid={reasonTooLong} aria-describedby={reasonTooLong ? `${id}-reason-error` : undefined} disabled={action.busy || action.unknown} onChange={(event) => setReason(event.target.value)} />{reasonTooLong && <p id={`${id}-reason-error`} role="alert" className="text-sm text-destructive">The reason is too long. Shorten it before cancelling.</p>}</div>
      <p className="text-sm text-muted-foreground">The server checks the group again before changing it. A changed appointment requires a fresh review. Cancellation preserves appointment and audit history.</p>
      {action.error && <Alert variant="destructive"><AlertTitle>{action.unknown ? 'Cancellation status unknown' : 'Cancellation not confirmed'}</AlertTitle><AlertDescription>{action.error.message}</AlertDescription></Alert>}
    </>}
    {!canManage && <p role="alert" className="text-sm text-destructive">Booking permission changed. Close this dialog to review current access.</p>}
    <DialogFooter><Button type="button" variant="outline" disabled={action.busy} onClick={close}>{action.saved ? 'Done' : 'Close'}</Button>{!action.saved && canManage && <Button type="button" variant="destructive" disabled={action.busy || !reason.trim() || reasonTooLong} onClick={submit}>{action.busy ? 'Cancelling…' : action.unknown ? 'Retry same cancellation' : 'Confirm cancellation'}</Button>}</DialogFooter>
  </DialogContent></Dialog>;
}
