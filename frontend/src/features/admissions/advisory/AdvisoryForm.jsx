import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ADVISORY_TYPES, DECISIONS } from './model';
import { AdvisoryEvidence } from './AdvisoryEvidence';
export function AdvisoryForm({ draft, disabled, onChange, reviewed, onReview }) {
  const create = draft.kind === 'create'; const required = !create && draft.decision !== 'completed';
  return <section aria-label="Follow-up review" className="space-y-5 rounded-xl border bg-card p-4 sm:p-5">
    <h3 className="font-heading text-xl">{create ? 'Add admission follow-up' : `${DECISIONS[draft.decision]} follow-up`}</h3>
    {!create && <AdvisoryEvidence value={draft.source} title="Task being reviewed" />}
    <fieldset disabled={disabled} className="space-y-4 disabled:opacity-70">
      {create ? <><div className="space-y-2"><Label htmlFor="advisory-type">Follow-up type</Label><Select value={draft.taskType} onValueChange={(taskType) => onChange({ ...draft, taskType })}><SelectTrigger id="advisory-type"><SelectValue placeholder="Choose a follow-up type" /></SelectTrigger><SelectContent>{draft.context.available_types.map((key) => <SelectItem key={key} value={key}>{ADVISORY_TYPES[key]}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label htmlFor="advisory-notes">Follow-up note</Label><Textarea id="advisory-notes" rows={5} maxLength={4000} value={draft.notes} onChange={(event) => onChange({ ...draft, notes: event.target.value })} /><p className="text-xs text-muted-foreground">State the follow-up needed. Saving trims surrounding whitespace.</p></div></> : <div className="space-y-2"><Label htmlFor="advisory-reason">{required ? 'Reason (required)' : 'Completion note (optional)'}</Label><Textarea id="advisory-reason" rows={4} maxLength={2000} value={draft.reason} onChange={(event) => onChange({ ...draft, reason: event.target.value })} /><p className="text-xs leading-5 text-muted-foreground">{draft.decision === 'acknowledged_unresolved' ? 'This records that the follow-up is still unresolved. It does not mark it completed.' : draft.decision === 'cancelled' ? 'Explain why this task is being cancelled. Its original note remains in history.' : 'Record completion only when the follow-up has actually been done.'}</p></div>}
      <div className="flex items-start gap-3 rounded-lg border bg-muted/15 p-3"><Checkbox id="advisory-reviewed" checked={reviewed} onCheckedChange={(value) => onReview(value === true)} /><Label htmlFor="advisory-reviewed" className="text-sm leading-6">I confirmed this patient and admission case and reviewed this follow-up change.</Label></div>
    </fieldset>
  </section>;
}
