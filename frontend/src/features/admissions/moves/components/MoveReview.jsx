import { useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { MoveButton as Button } from './MoveButton';
import { PlacementLabels } from './PlacementEvidence';
export function MoveReview({ command, allowed, controller, onBack }) {
  const [confirmed, setConfirmed] = useState(false), source = command.source;
  return <section className="flex min-w-0 flex-col gap-4" aria-label="Review admission move">
    <h3 className="font-heading text-lg">Review this move</h3>
    <div className="rounded-lg border bg-muted/20 p-4"><p><PlacementLabels labels={source.current_placement.labels} /> → <PlacementLabels labels={command.destination} /></p><p className="mt-2 text-sm">The admission, encounter, visit and original admission time stay the same.</p></div>
    <p className="text-sm">All {source.open_task_count} open tasks route to the destination ward. {source.assigned_open_task_count} assignments clear, including a move between beds in the same ward. Instructions and terminal task evidence remain unchanged.</p>
    <p className="text-sm">The vacated bed enters cleaning for {source.source_cleaning_minutes} minutes. A zero-minute cleaning period still records the original cleaning state.</p>
    <div><p className="text-xs text-muted-foreground">Reason for the move</p><p className="whitespace-pre-wrap break-words text-sm">{command.payload.reason}</p></div>
    <div className="flex items-start gap-3"><Checkbox id="move-reviewed" checked={confirmed} disabled={!allowed || controller.busy} onCheckedChange={value => setConfirmed(value === true)} /><Label htmlFor="move-reviewed">I reviewed the destination, all-open task routing and source-bed cleaning</Label></div>
    {!allowed && <p role="alert" className="text-sm">The placement or current write access changed. Refresh and review the move again.</p>}
    {controller.error && <p role="alert" className="text-sm text-destructive">{controller.error}</p>}
    <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={controller.busy} onClick={onBack}>Back to destination</Button><Button type="button" disabled={!allowed || !confirmed || controller.busy} onClick={() => controller.run(command)}>{controller.busy ? 'Recording move…' : 'Confirm move now'}</Button></div>
  </section>;
}
