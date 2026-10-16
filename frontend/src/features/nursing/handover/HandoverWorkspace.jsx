import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { draftFromSource, emptyHandover, handoverPayload } from './model';
import { HandoverEvidence } from './HandoverEvidence';
import { HandoverFields } from './HandoverFields';
import { HandoverReview } from './HandoverReview';
import { HandoverList } from './HandoverList';
import { HandoverCurrent } from './HandoverCurrent';
import { useHandoverCommand } from './useHandoverCommand';

function CommandResult({ command, patientLabel, canWrite, onCurrent }) {
  if (command.saved) return <>
    <p role="status" className="rounded-xl border bg-muted/20 p-4 text-sm font-medium">Handover change saved. This is its immutable saved receipt; current state may change later.</p>
    <HandoverEvidence revision={command.saved.handover.current} title="Original saved result" />
    {command.refreshFailed && <p role="alert">Saved successfully, but the list could not refresh. Refresh before another change.</p>}
    <Button type="button" variant="outline" onClick={onCurrent}>Review current handover</Button>
  </>;
  return <>
    <p role="alert" className="rounded-xl border p-4 text-sm">{command.error}</p>
    <HandoverReview command={command.frozen} patientLabel={patientLabel} title="Unchanged reviewed request" />
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" disabled={command.busy} onClick={() => command.run(null, true)}>Check original saved result</Button>
      <Button type="button" disabled={command.busy || !canWrite} onClick={() => command.run()}>Retry exact handover change</Button>
    </div>
  </>;
}
function ReviewConfirmation({ patientLabel, review, source, confirmed, onConfirm }) {
  return <section aria-label="Handover change review" className="grid gap-3 rounded-xl border p-4">
    <h3 className="font-medium">Confirm the reviewed change</h3>
    <p className="text-sm">{patientLabel} · {review.kind === 'void' ? 'Void this report; original evidence stays in history.' : `${review.payload.shift_date} · ${review.payload.shift_type} shift`}</p>
    <p className="text-sm">{review.kind === 'record' ? 'Record a narrative for the selected admission.' : `Append revision ${source.revision + 1}; earlier evidence remains unchanged.`}</p>
    <div className="flex items-start gap-3"><Checkbox id="handover-reviewed" checked={confirmed} onCheckedChange={(value) => onConfirm(value === true)} /><Label htmlFor="handover-reviewed">I confirmed this patient and admission and reviewed every field.</Label></div>
  </section>;
}
export function HandoverWorkspace({ open, onClose, patientId, admissionId, patientLabel, scope, actorId, list, onDenied, canWrite, onListFilter, includeVoided, allHistory, onHistoryScope, onSaved }) {
  const command = useHandoverCommand(scope, patientId, onSaved);
  const [selected, setSelected] = useState(null);
  const [kind, setKind] = useState(null);
  const [source, setSource] = useState(null);
  const [form, setForm] = useState(emptyHandover);
  const [review, setReview] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [validation, setValidation] = useState(null);
  const locked = command.busy || command.unknown || Boolean(command.saved);
  const close = () => { if (!command.busy) onClose(); };
  const start = (action, value = null) => {
    if (locked || !canWrite) return;
    setKind(action); setSource(value); setForm(value ? draftFromSource(value) : emptyHandover());
    setReview(null); setConfirmed(false); setValidation(null);
  };
  const prepare = () => {
    try {
      const payload = handoverPayload(kind, form, { patientId, admissionId, source, requestId: crypto.randomUUID() });
      setReview({ kind, payload, source, patientId, recipientName: form.recipient_name, admissionId: source?.admission_case_id || admissionId, actorId });
      setConfirmed(false); setValidation(null);
    } catch (error) { setValidation(error.message); }
  };
  if (!open) return null;
  return <Dialog open onOpenChange={(next) => { if (!next) close(); }}>
    <DialogContent className="flex max-h-[92dvh] min-w-0 flex-col overflow-hidden sm:max-w-5xl" onEscapeKeyDown={(event) => { if (command.busy) event.preventDefault(); }} onInteractOutside={(event) => { if (command.busy) event.preventDefault(); }}>
      <DialogHeader><DialogTitle>Patient handover</DialogTitle><DialogDescription>{patientLabel} · {admissionId ? 'Selected admission' : 'Patient history'}. Recorded narratives remain available with their revisions. Recipient receipt is not tracked.</DialogDescription></DialogHeader>
      <div className="grid min-h-0 min-w-0 flex-1 gap-6 overflow-y-auto pr-1 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <HandoverList {...{ admissionId, canWrite, locked, onListFilter, onHistoryScope, includeVoided, allHistory, list }} onStart={start} onSelect={(id) => { setSelected(id); setKind(null); }} />
        <div className="grid min-w-0 content-start gap-5">
          {command.saved || command.unknown ? <CommandResult {...{ command, patientLabel, canWrite }} onCurrent={() => { const id = command.saved.handover.id; command.reset(); setKind(null); setSelected(id); }} /> : kind ? <>
            {review ? <HandoverReview command={review} patientLabel={patientLabel} /> : <>
              <HandoverFields {...{ form, kind, scope, patientId, open, onDenied }} admissionId={source?.admission_case_id || admissionId} sourceId={source?.id} disabled={command.busy || !canWrite} onChange={(value) => { setForm(value); setConfirmed(false); }} />
              {kind === 'void' && source && <HandoverEvidence revision={source.current} title="Report being voided" />}
            </>}
            {validation && <p role="alert" className="text-sm text-destructive">{validation}</p>}
            {command.error && <p role="alert" className="text-sm text-destructive">{command.error}</p>}
            {review && <ReviewConfirmation {...{ patientLabel, review, source, confirmed }} onConfirm={setConfirmed} />}
          </> : selected ? <HandoverCurrent key={selected} {...{ selected, scope, patientId, admissionId, open, onDenied, canWrite, actorId }} onStart={start} /> : <p className="rounded-xl border p-5 text-sm text-muted-foreground">Select a recorded handover to review its evidence and history.{!admissionId && ' New reports require a current active admission.'}</p>}
        </div>
      </div>
      <DialogFooter className="shrink-0 flex-wrap gap-2 border-t pt-4">
        {kind && !locked && (review ? <>
          <Button type="button" variant="outline" onClick={() => { setReview(null); setConfirmed(false); }}>Edit review</Button>
          <Button type="button" disabled={!confirmed || !canWrite} onClick={() => command.run(review)}>{kind === 'void' ? 'Confirm reviewed void' : 'Save reviewed handover'}</Button>
        </> : <Button type="button" disabled={!canWrite} onClick={prepare}>Review handover change</Button>)}
        <Button type="button" variant="outline" disabled={command.busy} onClick={close}>Close</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
