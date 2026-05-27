/* oxlint-disable react-doctor/prefer-useReducer -- These components keep independent UI states; a reducer would add dispatch indirection without a shared transition invariant. */
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

import { useCreateProblem } from '../hooks';
import ProblemCodePicker from './ProblemCodePicker';

const PRIORITIES = [
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

const VERIFICATION_STATUSES = [
  { value: 'provisional', label: 'Provisional' },
  { value: 'differential', label: 'Differential' },
  { value: 'confirmed', label: 'Confirmed' },
];

/**
 * AddProblemDialog
 *
 * Two-step flow:
 *  1. Pick a ProblemCode (or fall back to free text).
 *  2. Set verification status, priority, optional note. Save.
 */
export default function AddProblemDialog({ open, onOpenChange, patientId }) {
  const [picked, setPicked] = useState(null);
  const [freeText, setFreeText] = useState('');
  const [verification, setVerification] = useState('provisional');
  const [priority, setPriority] = useState('medium');
  const [note, setNote] = useState('');

  const createProblem = useCreateProblem(patientId);

  const reset = () => {
    setPicked(null);
    setFreeText('');
    setVerification('provisional');
    setPriority('medium');
    setNote('');
  };

  const handleClose = (next) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const handlePicked = (selection) => {
    if (selection?.freeText) {
      setFreeText(selection.freeText);
      setPicked(null);
      return;
    }
    setPicked(selection);
    if (selection.is_chronic_default) {
      setVerification('confirmed');
    }
  };

  const submit = async () => {
    const payload = {
      verification_status: verification,
      priority,
      note,
    };
    if (picked) {
      payload.code_id = picked.id;
      if (picked.is_chronic_default) payload.chronicity = 'chronic';
    } else if (freeText.trim()) {
      payload.free_text_label = freeText.trim();
    } else {
      toast.error('Pick a code or enter free text.');
      return;
    }

    try {
      await createProblem.mutateAsync(payload);
      toast.success('Problem added.');
      handleClose(false);
    } catch (err) {
      toast.error(err?.message || 'Failed to add problem.');
    }
  };

  const hasSelection = !!picked || !!freeText.trim();

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Add problem</DialogTitle>
          <DialogDescription>
            Pick from common Ghanaian conditions or search ICD-10. Free text is allowed
            when no code matches.
          </DialogDescription>
        </DialogHeader>

        {!hasSelection ? (
          <ProblemCodePicker autoFocus onSelect={handlePicked} />
        ) : (
          <div className="space-y-4">
            <div className="rounded-md border bg-muted/40 p-3">
              {picked ? (
                <div className="flex items-start gap-3">
                  <code className="font-mono text-xs text-muted-foreground tabular-nums shrink-0 mt-0.5 w-16">
                    {picked.code}
                  </code>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground">{picked.display}</p>
                    <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                      {picked.code_system}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-foreground">
                  Free-text problem: <strong>{freeText}</strong>
                </p>
              )}
              <Button
                variant="link"
                size="sm"
                className="px-0"
                onClick={() => {
                  setPicked(null);
                  setFreeText('');
                }}
              >
                Change
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Verification</Label>
                <Select value={verification} onValueChange={setVerification}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {VERIFICATION_STATUSES.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Priority</Label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Note (optional)</Label>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Additional clinical context…"
                rows={3}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => handleClose(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!hasSelection || createProblem.isPending}>
            {createProblem.isPending ? 'Adding…' : 'Add problem'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
