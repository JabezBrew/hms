import { useId, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const CATEGORIES = [
  ['life_threatening_emergency', 'Life-threatening emergency'],
  ['patient_unconscious_or_unidentified', 'Patient unconscious or unidentified'],
  ['handover_or_assignment_gap', 'Handover or assignment gap'],
  ['urgent_clinical_continuity', 'Urgent continuity of care'],
  ['other_emergency', 'Other emergency'],
];

export default function BreakGlassDialog({
  open, onOpenChange, patientName, patientMrn, reason, onReasonChange,
  onSubmit, isSubmitting, ttlMinutes = 30, rustV2Mode = false, error,
}) {
  const id = useId();
  const [password, setPassword] = useState('');
  const [category, setCategory] = useState('');
  const reasonCount = reason?.trim().length || 0;
  const valid = rustV2Mode ? Boolean(category && password) : reasonCount >= 6;
  const close = (nextOpen) => {
    if (isSubmitting) return;
    if (!nextOpen) { setPassword(''); setCategory(''); }
    onOpenChange(nextOpen);
  };
  const submit = async (event) => {
    event.preventDefault();
    if (!valid || isSubmitting) return;
    try {
      await onSubmit(rustV2Mode ? { password, category, reason } : undefined);
    } finally {
      setPassword('');
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Emergency clinical access</DialogTitle>
          <DialogDescription>Request temporary access for urgent care. Your reason and access are audited.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="rounded-lg border bg-muted/30 p-4 text-sm">
            <p className="font-medium">{patientName || 'This patient record'}</p>
            {patientMrn && <p className="text-muted-foreground">MRN {patientMrn}</p>}
          </div>
          {rustV2Mode && <div className="grid gap-2">
            <Label htmlFor={`${id}-category`}>Emergency category</Label>
            <Select value={category} onValueChange={setCategory} disabled={isSubmitting}>
              <SelectTrigger id={`${id}-category`}><SelectValue placeholder="Choose the clinical need" /></SelectTrigger>
              <SelectContent>{CATEGORIES.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
            </Select>
          </div>}
          <div className="grid gap-2">
            <Label htmlFor={`${id}-reason`}>Reason for access{rustV2Mode ? ' (optional)' : ''}</Label>
            <Textarea id={`${id}-reason`} value={reason} onChange={(event) => onReasonChange(event.target.value)} maxLength={500} rows={3} disabled={isSubmitting} />
            <p className="text-xs text-muted-foreground">{rustV2Mode ? 'Add clinical context if needed.' : 'Minimum 6 characters required.'} {reason?.length || 0}/500</p>
          </div>
          {rustV2Mode && <div className="grid gap-2">
            <Label htmlFor={`${id}-password`}>Current password</Label>
            <Input id={`${id}-password`} type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={isSubmitting} />
            <p className="text-xs text-muted-foreground">Confirm your password to start a fresh sign-in session before requesting access.</p>
          </div>}
          <p className="text-sm text-muted-foreground">Access expires automatically after {ttlMinutes} minutes. End it as soon as urgent care is complete.</p>
          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => close(false)} disabled={isSubmitting}>Cancel</Button>
            <Button type="submit" disabled={!valid || isSubmitting}>{isSubmitting ? 'Verifying and requesting…' : 'Request emergency access'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
