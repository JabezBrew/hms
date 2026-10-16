import { useId, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useSeriesSlots } from './hooks';
import { formatSeriesTime, slotKey, utcDay } from './model';
export function SeriesSlotPicker({ context, rows, onAdd, disabled }) {
  const id = useId(); const [day, setDay] = useState(utcDay);
  const query = useSeriesSlots({ start_date: day, end_date: day, clinic_id: context.clinicId, service_id: context.serviceId, ...(context.practitionerId ? { practitioner_user_id: context.practitionerId } : {}) }, Boolean(day));
  const latest = new Date(); latest.setUTCDate(latest.getUTCDate() + 180);
  const selected = new Set(rows.map(slotKey));
  const slots = query.data || [];
  return <section className="grid gap-3" aria-label="Choose appointment slots">
    <div className="grid max-w-xs gap-2"><Label htmlFor={`${id}-day`}>Find session slots on (UTC)</Label><Input id={`${id}-day`} type="date" value={day} min={utcDay()} max={latest.toISOString().slice(0, 10)} disabled={disabled} onChange={(event) => setDay(event.target.value)} /></div>
    {query.isError ? <Alert variant="destructive"><AlertDescription>Current availability could not be loaded. <Button type="button" variant="outline" size="sm" onClick={() => query.refetch()}>Retry availability</Button></AlertDescription></Alert> : query.isFetching ? <p role="status" className="text-sm text-muted-foreground">Loading current session slots…</p> : <div className="grid max-h-64 gap-2 overflow-y-auto sm:grid-cols-2">{slots.map((slot) => {
      const overbook = Number(slot.capacity?.remaining) <= 0 && Number(slot.capacity?.overbook_remaining) > 0;
      const unavailable = !slot.session_id || Date.parse(slot.start) <= Date.now() || (!overbook && Number(slot.capacity?.remaining) <= 0) || ['busy-unavailable', 'cancelled'].includes(slot.status);
      return <Button key={slotKey(slot)} type="button" variant="outline" className="h-auto justify-start whitespace-normal p-3 text-left" disabled={disabled || unavailable || selected.has(slotKey(slot)) || rows.length >= 50} onClick={() => onAdd({ ...slot, requires_overbook: overbook, overbook_reason: '' })}><span><span className="block font-medium">{formatSeriesTime(slot.start)}</span><span className="mt-1 block text-xs text-muted-foreground">{slot.session_name}{selected.has(slotKey(slot)) ? ' · Added' : overbook ? ' · Overbooking reason required' : ' · Select slot'}</span></span></Button>;
    })}</div>}
    {!query.isError && !query.isFetching && slots.length === 0 && <p className="text-sm text-muted-foreground">No matching session slots on this date.</p>}
    <p className="text-xs text-muted-foreground">Up to 100 matching slots are shown for the selected date. Capacity is checked again when the whole group is booked.</p>
  </section>;
}
