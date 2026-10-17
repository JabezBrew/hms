import { Badge } from '@/components/ui/badge';
export function PlacementLabels({ labels }) {
  return <span className="break-words">{labels.ward_name} · Bed {labels.bed_code}{labels.section_name ? ` · ${labels.section_name}` : ''}</span>;
}
export function PlacementEvidence({ current }) {
  const placement = current.current_placement;
  return <section className="space-y-3 rounded-lg border bg-muted/20 p-4" aria-label="Current admission placement">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-heading text-base">{placement ? 'Current placement' : 'Admission case location'}</h3><Badge variant="outline">{current.status.replaceAll('_', ' ')}</Badge></div>
    <p className="font-medium">{current.ward_name} · {current.bed_code ? `Bed ${current.bed_code}` : 'No current bed'}</p>
    {current.admitted_at && <p className="text-xs text-muted-foreground">Admission began {new Date(current.admitted_at).toLocaleString()}.</p>}
    <p className="text-sm text-muted-foreground">{placement?.origin === 'legacy_current_observation' ? 'The earlier placement start is unknown. This is an observation of the current placement.' : placement ? `This placement began ${new Date(placement.started_at).toLocaleString()}.` : 'No current open placement is recorded.'}</p>
    {current.placement_history_partial && <p className="text-sm text-muted-foreground">Placement history has an unknown earlier period. Recorded moves do not reconstruct that period.</p>}
    <p className="text-sm">{current.open_task_count} open tasks · {current.assigned_open_task_count} current assignments</p>
  </section>;
}
export function MoveEvidence({ movement, original = false }) {
  return <section className="space-y-4" aria-label={original ? 'Original saved move' : 'Recorded move'}>
    <h3 className="font-heading text-lg">{original ? 'Original saved move' : 'Recorded move'}</h3>
    <dl className="grid min-w-0 gap-3 sm:grid-cols-2"><div><dt className="text-xs text-muted-foreground">From</dt><dd><PlacementLabels labels={movement.source} /></dd></div><div><dt className="text-xs text-muted-foreground">To</dt><dd><PlacementLabels labels={movement.destination} /></dd></div></dl>
    <p className="text-sm">Recorded by {movement.recorded_by_display_name} · {new Date(movement.moved_at).toLocaleString()}</p>
    <div><p className="text-xs text-muted-foreground">Reason</p><p className="whitespace-pre-wrap break-words text-sm">{movement.reason}</p></div>
    <p className="text-sm">All {movement.task_result.routed_task_count} open tasks routed to the destination ward; {movement.task_result.cleared_assignee_count} assignments cleared. Instructions and terminal task evidence are unchanged.</p>
    <p className="text-sm">The vacated source bed entered cleaning for {movement.source_bed_release.cleaning_minutes} minutes, due {new Date(movement.source_bed_release.cleaning_due_at).toLocaleString()}. This is its saved state at the move.</p>
    <p className="text-xs text-muted-foreground">This move preserved the admission, encounter, visit and original admission time. The current placement may since have changed.</p>
  </section>;
}
