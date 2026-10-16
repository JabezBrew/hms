import { useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { userHasCapability } from '@/shared/lib/access';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useStandingRequestReview, useStandingWrite } from './hooks';
import { StandingRequestLines } from './StandingTemplateSummary';
export function StandingRequestReviewDialog({ id, onClose }) {
  const { user } = useAuth();
  const query = useStandingRequestReview(id);
  const approve = useStandingWrite('approve');
  const issue = useStandingWrite('issue');
  const cancel = useStandingWrite('cancel');
  const [confirmation, setConfirmation] = useState(null);
  const saving = useRef(false);
  const busy = approve.isPending || issue.isPending || cancel.isPending;
  const saved = cancel.data || issue.data || approve.data;
  const request = !query.isFetchedAfterMount && !saved ? null : query.isError ? saved : query.data || saved;
  const action = confirmation === 'cancel' ? cancel : confirmation === 'issue' ? issue : approve;
  const error = cancel.error || issue.error || approve.error;
  const unknown = error?.code === 'standing_write_unconfirmed';
  const canManage = userHasCapability(user, 'inventory.manage');
  const fresh = query.isFetchedAfterMount && !query.isError && !query.isFetching && Boolean(query.data);
  const close = () => { if (!busy) onClose(); };
  const refresh = async () => {
    const result = await query.refetch();
    if (!result.isError && !result.error) { approve.reset(); issue.reset(); cancel.reset(); setConfirmation(null); }
  };
  const confirm = async () => {
    if (saving.current || busy || unknown || !fresh || !canManage || !confirmation) return;
    if ((confirmation === 'approve' && !['requested', 'pending'].includes(request.status)) || (confirmation === 'issue' && request.status !== 'approved') || (confirmation === 'cancel' && !['requested', 'pending', 'approved'].includes(request.status))) return;
    saving.current = true;
    try { await action.mutateAsync([id, { expected_source_version: request.template_version }]); setConfirmation(null); }
    catch { /* Keep definite failures and uncertain commits visible for review. */ }
    finally { saving.current = false; }
  };
  return <Dialog open onOpenChange={(open) => { if (!open) close(); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
    <DialogHeader><DialogTitle>Review stock request</DialogTitle><DialogDescription>Review the saved item and unit snapshots. Approval and stock issue are separate actions.</DialogDescription></DialogHeader>
    {query.isError && !saved ? <Alert variant="destructive"><AlertDescription>{query.error.status === 404 ? 'Item details are unavailable for this older request.' : 'The request could not be refreshed. Stock actions are unavailable until a fresh read succeeds.'}<Button type="button" variant="outline" size="sm" className="mt-3" onClick={refresh}>Retry request</Button></AlertDescription></Alert> : !request ? <p role="status">Loading current request…</p> : <>
      {saved && <Alert role="status"><AlertTitle>{saved.status === 'cancelled' ? 'Cancellation confirmed' : saved.status === 'fulfilled' ? 'Stock issue confirmed' : 'Approval confirmed'}</AlertTitle><AlertDescription>{saved.status === 'cancelled' ? 'The request is cancelled. This action did not move stock.' : saved.status === 'fulfilled' ? 'The server confirmed the stock transfer and issued quantities.' : 'The approval is saved. Stock has not been issued by this action.'}</AlertDescription></Alert>}
      {query.isError && saved && <Alert variant="destructive"><AlertDescription>The saved change is confirmed, but the latest request status could not refresh. Stock actions are unavailable.<Button type="button" variant="outline" size="sm" className="mt-3" onClick={refresh}>Refresh request</Button></AlertDescription></Alert>}
      <StandingRequestLines request={request} />
      {canManage && fresh && !unknown && ['requested', 'pending', 'approved'].includes(request.status) && !confirmation && <div className="flex flex-wrap gap-2"><Button type="button" disabled={busy} onClick={() => setConfirmation(request.status === 'approved' ? 'issue' : 'approve')}>{request.status === 'approved' ? 'Issue requested stock' : 'Approve request'}</Button><Button type="button" variant="outline" disabled={busy} onClick={() => setConfirmation('cancel')}>Cancel request</Button></div>}
      {confirmation && <Alert><AlertTitle>{confirmation === 'cancel' ? 'Cancel this stock request?' : confirmation === 'approve' ? 'Approve this item request?' : 'Issue all remaining requested stock?'}</AlertTitle><AlertDescription><p>{confirmation === 'cancel' ? 'Keep this request and its item snapshots as a cancelled record. Cancellation does not move stock and cannot be undone.' : confirmation === 'approve' ? 'Record approval of these exact item and unit snapshots. Approval does not move stock.' : `Transfer the remaining quantities from ${request.fulfilling_location_name} to ${request.requesting_location_name}. Eligible batches are selected by expiry. If any line cannot be issued safely, no line is issued.`}</p><div className="mt-3 flex gap-2"><Button type="button" variant="outline" size="sm" disabled={busy || unknown} onClick={() => setConfirmation(null)}>Back</Button><Button type="button" size="sm" disabled={busy || unknown || !fresh || !canManage} onClick={confirm}>{busy ? 'Saving…' : confirmation === 'cancel' ? 'Confirm cancellation' : confirmation === 'approve' ? 'Confirm approval' : 'Confirm stock issue'}</Button></div></AlertDescription></Alert>}
    </>}
    {error && <Alert variant="destructive"><AlertTitle>{unknown ? 'Change status unknown' : 'Change not saved'}</AlertTitle><AlertDescription>{error.message}{unknown && <Button type="button" variant="outline" size="sm" className="mt-3" disabled={busy || query.isFetching} onClick={refresh}>Refresh request status</Button>}</AlertDescription></Alert>}
    <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={close}>Done</Button></DialogFooter>
  </DialogContent></Dialog>;
}
