import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAdministerMedication } from '@/features/nursing/hooks';

const OUTCOMES = { administered: 'Administered', missed: 'Missed', refused: 'Patient refused', held: 'Held' };

/** One explicit decision for an existing source dose, never an anonymous PRN copy. */
export function MedicationOutcomeDialog({ medication, onClose, onRecorded }) {
  const [status, setStatus] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [unconfirmed, setUnconfirmed] = useState(false);
  const inFlight = useRef(false);
  const mutation = useAdministerMedication();
  const unsupplied = Boolean(medication.prescription_id && !medication.is_dispensed);
  const futureDose = Date.parse(medication.scheduled_time || medication.scheduled_at) > Date.now();
  const nonadministration = status && status !== 'administered';
  const close = () => { if (!inFlight.current) onClose(); };
  const submit = async () => {
    if (inFlight.current || unconfirmed || !status) return;
    if (nonadministration && !reason.trim()) { toast.error('A reason is required when a dose is not given.'); return; }
    inFlight.current = true;
    try {
      await mutation.mutateAsync({ medicationId: medication.id, data: { status, reason_not_given: reason, administration_notes: notes } });
      toast.success(`Dose outcome recorded: ${OUTCOMES[status].toLowerCase()}`);
      // A refresh callback cannot undo a confirmed clinical decision.
      try { await onRecorded?.(); } catch { /* Shared query invalidation still runs. */ }
      onClose();
    } catch (error) {
      if (error?.name === 'MedicationOutcomeUnconfirmedError') setUnconfirmed(true);
      toast.error(error?.message || 'The dose outcome could not be recorded.');
    } finally { inFlight.current = false; }
  };
  return <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Record dose outcome</DialogTitle>
        <DialogDescription>{medication.medication_name} · {medication.dosage || medication.dose} · {medication.route_display || medication.route}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <p className="text-sm text-foreground">Scheduled: {new Date(medication.scheduled_time || medication.scheduled_at).toISOString().slice(0, 16).replace('T', ' ')} UTC</p>
        {medication.prn_indication && <p className="text-sm">As-needed indication: {medication.prn_indication}</p>}
        {unsupplied && <p className="text-sm text-muted-foreground">This prescribed dose is awaiting pharmacy supply. You can record why it was not given.</p>}
        {unconfirmed && <p role="alert" className="text-sm text-destructive">The outcome may have been saved. Review the refreshed MAR before trying again. Close this dialog to continue.</p>}
        <div className="space-y-2">
          <Label htmlFor="medication-dose-outcome">Dose outcome</Label>
          <Select value={status} disabled={mutation.isPending || unconfirmed} onValueChange={(value) => { setStatus(value); setReason(''); }}>
            <SelectTrigger id="medication-dose-outcome"><SelectValue placeholder="Choose what happened" /></SelectTrigger>
            <SelectContent>{Object.entries(OUTCOMES).map(([value, label]) => <SelectItem key={value} value={value} disabled={(value === 'administered' && unsupplied) || (value === 'missed' && futureDose)}>{label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {nonadministration && <div className="space-y-2">
          <Label htmlFor="medication-dose-reason">Reason the dose was not given</Label>
          <Textarea id="medication-dose-reason" value={reason} onChange={(event) => setReason(event.target.value)} disabled={mutation.isPending || unconfirmed} maxLength={1000} rows={3} />
        </div>}
        <div className="space-y-2">
          <Label htmlFor="medication-dose-notes">Notes (optional)</Label>
          <Textarea id="medication-dose-notes" value={notes} onChange={(event) => setNotes(event.target.value)} disabled={mutation.isPending || unconfirmed} maxLength={2000} rows={3} />
        </div>
        <p className="text-xs text-muted-foreground">Recorded outcomes are permanent. Check the dose and selected outcome before saving.</p>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={close} disabled={mutation.isPending}>{unconfirmed ? 'Close' : 'Cancel'}</Button>
        <Button onClick={submit} disabled={mutation.isPending || unconfirmed || !status || (nonadministration && !reason.trim())}>{mutation.isPending ? 'Recording…' : 'Record outcome'}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
