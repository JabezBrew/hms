import { useEffect, useId, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { userHasCapability } from '@/shared/lib/access';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useFluidSource, useFluidWrite } from './hooks';
import { FluidValuesFields } from './FluidValuesFields';
import { formFromObservation, valuesPayload } from './model';
import { fluidTime } from './model';
function ChangeForm({ source, action, onClose, open }) {
  const id = useId(); const [values, setValues] = useState(() => formFromObservation(source)); const [reason, setReason] = useState(''); const [key] = useState(() => crypto.randomUUID()); const [validation, setValidation] = useState(null); const [review, setReview] = useState(false);
  const write = useFluidWrite(action, source.patient_id); const locked = write.busy || write.unknown || Boolean(write.saved);
  const close = () => { if (!write.busy) onClose({ preserve: write.unknown }); };
  const submit = async () => {
    if (locked && !write.unknown) return;
    if (write.unknown) { await write.submit(); return; }
    try {
      if (!reason.trim()) throw new Error('Record a reason for this change.');
      const payload = { client_request_id: key, reason: reason.trim(), ...(action === 'correct' ? { replacement: valuesPayload(values, source) } : {}) };
      if (!review) { setReview(true); setValidation(null); return; }
      await write.submit(source.id, payload, source.root_entry_id);
    } catch (error) { setValidation(error.message); }
  };
  return <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{action === 'correct' ? 'Correct fluid observation' : 'Void fluid observation'}</DialogTitle><DialogDescription>Changes append a recorded reason and retain the original clinical evidence.</DialogDescription></DialogHeader><p className="rounded-xl border p-3 text-sm">Current observation: {fluidTime(source.values.recorded_at)} · Intake {source.values.intake_ml} ml · Output {source.values.output_ml} ml. Revision {source.revision}.</p>
    {write.saved ? <p role="status" className="text-sm font-medium">{action === 'correct' ? 'Correction' : 'Void'} confirmed. Original evidence remains in history.</p> : <>
      {action === 'correct' && <FluidValuesFields value={values} onChange={setValues} disabled={locked || review} />}
      <div className="grid gap-2"><Label htmlFor={`${id}-reason`}>Reason for {action === 'correct' ? 'correction' : 'void'}</Label><Textarea id={`${id}-reason`} value={reason} maxLength={1000} disabled={locked || review} onChange={(e) => setReason(e.target.value)} /></div>
      {review && <p className="text-sm">{action === 'correct' ? 'Confirm the complete replacement above. Both intake and output values are preserved unless you explicitly change them.' : 'This observation will stop contributing to totals. The original values and reason remain in history.'}</p>}
      {(validation || write.error) && <p role="alert" className="text-sm text-destructive">{validation || write.error.message}</p>}
    </>}
    <DialogFooter><Button type="button" variant="outline" disabled={write.busy} onClick={close}>{write.saved ? 'Done' : 'Close'}</Button>{!write.saved && <>{review && !locked && <Button type="button" variant="outline" onClick={() => setReview(false)}>Change details</Button>}<Button type="button" disabled={write.busy} onClick={submit}>{write.busy ? 'Saving…' : write.unknown ? 'Retry exact change' : review ? 'Confirm change' : 'Review change'}</Button></>}</DialogFooter>
  </DialogContent></Dialog>;
}
export function FluidChangeDialog({ selected, onClose, open = true }) {
  const { user } = useAuth(); const allowed = userHasCapability(user, 'nursing.task.manage');
  return allowed ? <VerifiedChange selected={selected} onClose={onClose} open={open} /> : null;
}
function VerifiedChange({ selected, onClose, open }) {
  const query = useFluidSource(selected.source.id, open); const [verified, setVerified] = useState(null);
  useEffect(() => { if (!verified && query.isFetchedAfterMount && !query.isFetching && !query.isError && query.data?.current) setVerified(query.data); }, [verified, query.isFetchedAfterMount, query.isFetching, query.isError, query.data]);
  if (verified) return <ChangeForm key={verified.id} source={verified} action={selected.action} onClose={onClose} open={open} />;
  return <Dialog open={open} onOpenChange={(next) => { if (!next) onClose({ preserve: false }); }}><DialogContent><DialogHeader><DialogTitle>Check current fluid observation</DialogTitle><DialogDescription>Load the saved source before recording a change.</DialogDescription></DialogHeader>
    {query.isError ? <p role="alert">The current entry could not be loaded. <Button variant="outline" onClick={() => query.refetch()}>Refresh current entry</Button></p> : query.isFetchedAfterMount && !query.data?.current ? <p role="alert">This entry is no longer current. Review its history before continuing.</p> : <p role="status">Checking current observation…</p>}
  </DialogContent></Dialog>;
}
