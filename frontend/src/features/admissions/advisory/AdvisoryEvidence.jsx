import { Badge } from '@/components/ui/badge';
import { ADVISORY_TYPES, ADVISORY_STATUS, retirementLabel } from './model';
export function EvidenceTime({ value }) { return <time dateTime={value}>{new Date(value).toLocaleString()}</time>; }
export function AdvisoryEvidence({ value, title = 'Recorded follow-up' }) {
  const automatic = value.decision && value.decision.source !== 'manual';
  return <section aria-label={title} className="space-y-4 rounded-xl border bg-card p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-heading text-lg">{ADVISORY_TYPES[value.task_type]}</h3><Badge variant="outline">{ADVISORY_STATUS[value.status]}</Badge></div>
    <p className="whitespace-pre-wrap break-words text-sm leading-6">{value.notes}</p>
    <p className="text-xs leading-5 text-muted-foreground">Recorded by {value.created_by_display_name || 'Recorded clinician'} · <EvidenceTime value={value.created_at} /> · {value.captured_ward_name} · {value.phase === 'pre_activation' ? 'Before admission activation' : 'After admission activation'}</p>
    {value.decision && <div className="space-y-2 border-t pt-4"><p className="text-sm font-medium">{automatic ? retirementLabel(value.decision.source) : `Task decision: ${ADVISORY_STATUS[value.status]}`}</p>{automatic && <p className="text-sm text-muted-foreground">This pending task was retired with the episode. It was not recorded as completed or acknowledged.</p>}<p className="whitespace-pre-wrap break-words text-sm">{value.decision.reason || (automatic ? 'Episode closure recorded by the admission workflow.' : 'No completion note recorded.')}</p><p className="text-xs leading-5 text-muted-foreground">{value.decision.recorded_by_display_name || 'Recorded actor'} · <EvidenceTime value={value.decision.recorded_at} /> · {value.decision.ward_name}</p></div>}
  </section>;
}
