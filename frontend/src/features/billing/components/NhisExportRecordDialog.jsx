import { useRef } from 'react';
import { useExportNhisClaimBatch } from '@/features/billing/hooks';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function NhisExportRecordDialog({ batch, onClose }) {
  const record = useExportNhisClaimBatch();
  const submitting = useRef(false);
  const unconfirmed = record.error?.code === 'nhis_export_unconfirmed';
  const isReplay = batch.status === 'exported';
  const close = () => { if (!record.isPending) onClose(); };
  const save = async () => {
    if (submitting.current || record.isPending || record.data || unconfirmed) return;
    submitting.current = true;
    try {
      await record.mutateAsync({ batchId: batch.id, data: {} });
    } catch {
      // The safe definite/unknown outcome is shown inline.
    } finally {
      submitting.current = false;
    }
  };

  return <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{isReplay ? 'View export record' : 'Record NHIS export'}</DialogTitle>
        <DialogDescription>This saves an internal record of the batch summary. Claims keep their current status. File generation and submission to NHIS are not available here.</DialogDescription>
      </DialogHeader>
      {record.data ? <>
        <Alert role="status"><AlertTitle>Export record saved</AlertTitle><AlertDescription className="space-y-2">
          <p>{record.data.batch_number} · {record.data.claim_count} claims</p>
          <p>Claims have not been submitted by this action.</p>
          <div><p className="font-medium">Record checksum</p><p className="break-all font-mono text-xs">{record.data.checksum}</p></div>
        </AlertDescription></Alert>
        <DialogFooter><Button type="button" onClick={close}>Done</Button></DialogFooter>
      </> : <>
        <p className="text-sm">{batch.batch_number} · {batch.claim_count} claims</p>
        {isReplay && <p className="text-sm text-muted-foreground">Load the saved record without changing its timestamp or claim statuses.</p>}
        {record.error && <Alert variant="destructive"><AlertTitle>{unconfirmed ? 'Record status unknown' : isReplay ? 'Record could not be loaded' : 'Record not saved'}</AlertTitle><AlertDescription>{record.error.message}</AlertDescription></Alert>}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={record.isPending} onClick={close}>{unconfirmed ? 'Close and review records' : 'Cancel'}</Button>
          <Button type="button" disabled={record.isPending || unconfirmed} onClick={save}>{record.isPending ? 'Loading record…' : isReplay ? 'Load saved record' : 'Save export record'}</Button>
        </DialogFooter>
      </>}
    </DialogContent>
  </Dialog>;
}
