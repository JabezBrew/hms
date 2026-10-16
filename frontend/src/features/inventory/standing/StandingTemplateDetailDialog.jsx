import { useRef, useState } from 'react';
import { userHasCapability } from '@/shared/lib/access';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useStandingTemplate, useStandingWrite } from './hooks';
import { StandingRequestLines, StandingTemplateSaved } from './StandingTemplateSummary';
export function StandingTemplateDetailDialog({ id, user, onClose, onEdit, onReviewRequest }) {
  const query = useStandingTemplate(id);
  const run = useStandingWrite('run');
  const status = useStandingWrite('status');
  const [confirmation, setConfirmation] = useState(null);
  const submitted = useRef(false);
  const template = query.data;
  const action = confirmation?.kind === 'run' ? run : status;
  const busy = run.isPending || status.isPending;
  const unknown = action.error?.code === 'standing_write_unconfirmed';
  const canManage = userHasCapability(user, 'inventory.manage');
  const close = () => { if (!busy) onClose(); };
  const confirm = async () => {
    if (submitted.current || busy || action.data || unknown || !canManage) return;
    submitted.current = true;
    try { await action.mutateAsync([id, confirmation.payload]); }
    catch { /* Show the server's definite or unknown outcome; never auto-retry. */ }
    finally { submitted.current = false; }
  };
  return <Dialog open onOpenChange={(open) => { if (!open) close(); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
    <DialogHeader><DialogTitle>{run.data ? 'Stock request generated' : status.data ? 'Template status saved' : template?.name || 'Standing template'}</DialogTitle><DialogDescription>Review the saved configuration and generate one due occurrence explicitly. Generating a request does not move stock.</DialogDescription></DialogHeader>
    {run.data ? <><Alert role="status"><AlertTitle>Request saved</AlertTitle><AlertDescription>The server saved this request for the selected occurrence.</AlertDescription></Alert><StandingRequestLines request={run.data} /><Button type="button" variant="outline" onClick={() => onReviewRequest(run.data.id)}>Review and approve request</Button></> : status.data ? <StandingTemplateSaved template={status.data} /> : query.isError ? <Alert variant="destructive"><AlertDescription>The template could not be refreshed. Actions are unavailable until a fresh read succeeds. <Button type="button" variant="outline" size="sm" onClick={() => query.refetch()}>Retry template</Button></AlertDescription></Alert> : !template || query.isFetching ? <p role="status">Loading current template…</p> : <>
      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[auto_1fr]"><dt>Status</dt><dd>{template.status}</dd><dt>Requesting location</dt><dd>{template.requesting_location_name}</dd><dt>Fulfilling location</dt><dd>{template.fulfilling_location_name}</dd><dt>Frequency</dt><dd>{template.frequency === 'biweekly' ? 'Every two weeks' : template.frequency}</dd><dt>Next due date</dt><dd>{template.next_run_on} (UTC)</dd><dt>Version</dt><dd>{template.version}</dd></dl>
      <Table><TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Unit</TableHead><TableHead>Quantity</TableHead></TableRow></TableHeader><TableBody>{template.items.map((item) => <TableRow key={item.id}><TableCell><p>{item.item_name}</p><p className="text-xs text-muted-foreground">{item.item_code}</p></TableCell><TableCell>{item.unit}{item.requires_unit_review && <p className="text-xs text-destructive">Current unit: {item.current_unit}. Edit and review the quantity.</p>}</TableCell><TableCell>{item.quantity}</TableCell></TableRow>)}</TableBody></Table>
      {template.notes && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{template.notes}</p>}
      {confirmation ? <Alert><AlertTitle>{confirmation.kind === 'run' ? 'Generate this due request?' : `Set template to ${confirmation.payload.status}?`}</AlertTitle><AlertDescription><p>{confirmation.kind === 'run' ? `Generate the ${confirmation.payload.scheduled_for} occurrence (UTC) using version ${confirmation.payload.expected_version}. If several occurrences are overdue, one catch-up request is created and the next due date advances beyond today.` : 'Existing stock requests and their item snapshots remain unchanged. Cancelling a template is permanent.'}</p><div className="mt-3 flex gap-2"><Button type="button" variant="outline" size="sm" disabled={busy || unknown} onClick={() => setConfirmation(null)}>Back</Button><Button type="button" size="sm" disabled={busy || unknown} onClick={confirm}>{busy ? 'Saving…' : 'Confirm'}</Button></div></AlertDescription></Alert> : canManage && template.status !== 'cancelled' ? <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => onEdit(template)}>Edit template</Button>
        <Button type="button" variant="outline" onClick={() => setConfirmation({ kind: 'status', payload: { expected_version: template.version, status: template.status === 'active' ? 'paused' : 'active' } })}>{template.status === 'active' ? 'Pause template' : 'Resume template'}</Button>
        <Button type="button" variant="outline" onClick={() => setConfirmation({ kind: 'status', payload: { expected_version: template.version, status: 'cancelled' } })}>Cancel template</Button>
        <Button type="button" disabled={template.status !== 'active' || template.next_run_on > new Date().toISOString().slice(0, 10) || template.items.some((item) => item.requires_unit_review)} onClick={() => setConfirmation({ kind: 'run', payload: { scheduled_for: template.next_run_on, expected_version: template.version } })}>Generate due request</Button>
      </div> : null}
      {template.last_requisition_id && <Button type="button" variant="outline" disabled={busy} onClick={() => onReviewRequest(template.last_requisition_id)}>Review last generated request</Button>}
    </>}
    {action.error && <Alert variant="destructive"><AlertTitle>{unknown ? 'Save status unknown' : 'Change not saved'}</AlertTitle><AlertDescription>{action.error.message}</AlertDescription></Alert>}
    <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={close}>{unknown ? 'Close and review refreshed templates' : 'Done'}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
