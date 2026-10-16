import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export function PrescriptionDocumentationFields({ form, onChange, disabled = false, prefix = 'course' }) {
  return <fieldset disabled={disabled} className="flex flex-col gap-4"><legend className="mb-3 text-sm font-medium">Prescribing documentation</legend>
    <div className="flex flex-col gap-2"><Label htmlFor={`${prefix}-instructions`}>Instructions</Label><Textarea id={`${prefix}-instructions`} maxLength={4000} rows={3} value={form.instructions} onChange={(event) => onChange('instructions', event.target.value)} /><p className="text-xs text-muted-foreground">Administration instructions saved with this prescription. Up to 4000 characters.</p></div>
    <div className="flex flex-col gap-2"><Label htmlFor={`${prefix}-reason`}>Prescribing reason</Label><Input id={`${prefix}-reason`} maxLength={2000} value={form.reason} onChange={(event) => onChange('reason', event.target.value)} /><p className="text-xs text-muted-foreground">Up to 2000 characters.</p></div>
  </fieldset>;
}
