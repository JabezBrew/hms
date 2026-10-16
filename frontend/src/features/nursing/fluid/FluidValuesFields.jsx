import { useId } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { INTAKE, OUTPUT } from './model';
export function FluidValuesFields({ value, onChange, disabled }) {
  const id = useId(); const metadata = (key, next) => onChange({ ...value, metadata: { ...value.metadata, [key]: next } });
  return <div className="grid gap-4">
    <div className="grid gap-2"><Label htmlFor={`${id}-time`}>Observation time (UTC)</Label><Input id={`${id}-time`} type="datetime-local" value={value.recorded_at} disabled={disabled} onChange={(e) => onChange({ ...value, recorded_at: e.target.value })} /></div>
    <div className="grid gap-4 sm:grid-cols-2">{[['intake', INTAKE], ['output', OUTPUT]].map(([direction, categories]) => <fieldset key={direction} className="grid content-start gap-3 rounded-xl border p-4"><legend className="px-1 text-sm font-medium capitalize">{direction}</legend>
      <div className="grid gap-2"><Label htmlFor={`${id}-${direction}-volume`}>{direction === 'intake' ? 'Intake' : 'Output'} volume (ml)</Label><Input id={`${id}-${direction}-volume`} type="number" inputMode="numeric" min="0" step="1" value={value[`${direction}_ml`]} disabled={disabled} onChange={(e) => onChange({ ...value, [`${direction}_ml`]: e.target.value })} /></div>
      <div className="grid gap-2"><Label htmlFor={`${id}-${direction}-category`}>{direction === 'intake' ? 'Intake' : 'Output'} category</Label><Select value={value.metadata[`${direction}_category`] || 'unspecified'} disabled={disabled || !Number(value[`${direction}_ml`])} onValueChange={(v) => metadata(`${direction}_category`, v === 'unspecified' ? '' : v)}><SelectTrigger id={`${id}-${direction}-category`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unspecified">Choose category</SelectItem>{Object.entries(categories).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent></Select></div>
      <div className="grid gap-2"><Label htmlFor={`${id}-${direction}-detail`}>{direction === 'intake' ? 'Intake' : 'Output'} detail (optional)</Label><Input id={`${id}-${direction}-detail`} maxLength={50} value={value.metadata[`${direction}_subcategory`] || ''} disabled={disabled || !Number(value[`${direction}_ml`])} onChange={(e) => metadata(`${direction}_subcategory`, e.target.value)} /></div>
      {direction === 'output' && <div className="grid gap-2"><Label htmlFor={`${id}-colour`}>Output colour (optional)</Label><Input id={`${id}-colour`} maxLength={100} value={value.metadata.output_colour || ''} disabled={disabled || !Number(value.output_ml)} onChange={(e) => metadata('output_colour', e.target.value)} /></div>}
    </fieldset>)}</div>
    <div className="grid gap-2"><Label htmlFor={`${id}-notes`}>Observation notes (optional)</Label><Textarea id={`${id}-notes`} maxLength={2000} value={value.metadata.notes || ''} disabled={disabled} onChange={(e) => metadata('notes', e.target.value)} /></div>
  </div>;
}
