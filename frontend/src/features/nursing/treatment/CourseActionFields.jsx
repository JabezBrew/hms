import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { utcTime } from './model';

export function CourseActionFields({ kind, source, form, onChange, disabled }) {
  if (kind === 'stop') return <div className="grid gap-2"><Label htmlFor="course-stop-reason">Reason for stopping this admission course</Label><Textarea id="course-stop-reason" aria-required="true" value={form.reason} disabled={disabled} onChange={(event) => onChange('reason', event.target.value)} /><p className="text-xs text-muted-foreground">A reason is required. This does not stop the source prescription.</p></div>;
  return <>
    <p className="text-sm">Current schedule boundary: {utcTime(source.summary.scheduled_through)}. Choose an explicit UTC cutoff; no past records or inferred days are added.</p>
    <p className="text-sm text-muted-foreground">Latest currently allowed cutoff: {utcTime(source.supply_window_constraints?.scheduled_before_max)}. At most 512 new dose records; the exact count is confirmed after saving.</p>
    <div className="grid gap-2"><Label htmlFor="course-window-before">Schedule doses before (UTC)</Label><Input id="course-window-before" type="datetime-local" max={source.supply_window_constraints?.scheduled_before_max?.slice(0, 16)} value={form.scheduled_before} aria-required="true" disabled={disabled} onChange={(event) => onChange('scheduled_before', event.target.value)} /></div>
    <div className="grid gap-2"><Label htmlFor="course-window-note">Operational note (optional)</Label><Textarea id="course-window-note" value={form.note} disabled={disabled} onChange={(event) => onChange('note', event.target.value)} /></div>
  </>;
}
