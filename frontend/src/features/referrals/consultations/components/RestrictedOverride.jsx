import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export function RestrictedOverride({ current, confirmed, setConfirmed, code, setCode, note, setNote }) {
  if (!current.selection?.restricted_override_required) return null;
  return <section className="flex flex-col gap-3 rounded-lg border p-4"><p className="text-sm">This restricted patient record requires an explicit intake override.</p>
    {current.can_override_restricted_record ? <>
      <div className="flex items-start gap-3"><Checkbox id="consultation-override" checked={confirmed} onCheckedChange={value => setConfirmed(value === true)} /><Label htmlFor="consultation-override">Use an explicit restricted-record override</Label></div>
      <div className="flex flex-col gap-2"><Label htmlFor="consultation-reason-code">Override reason code</Label><Input id="consultation-reason-code" value={code} maxLength={64} onChange={event => setCode(event.target.value)} /></div>
      <div className="flex flex-col gap-2"><Label htmlFor="consultation-reason-note">Optional override note</Label><Textarea id="consultation-reason-note" value={note} maxLength={500} onChange={event => setNote(event.target.value)} /></div>
      <p className="text-xs text-muted-foreground">The note stays in RAM for this reviewed request. The start record retains only the reason code and whether a note was supplied.</p>
    </> : <p>Current patient update authority for this override is unavailable.</p>}
  </section>;
}
