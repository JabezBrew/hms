import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useSeriesWrite } from './hooks';
import { buildSeriesPayload, formatSeriesTime, slotKey } from './model';
import { SeriesMembers } from './SeriesMembers';
import { SeriesSlotPicker } from './SeriesSlotPicker';

function DraftMembers({ rows, onChange, readOnly }) {
  return <ol aria-label="Selected appointments" className="grid gap-3">{rows.map((row, index) => <li key={slotKey(row)} className="grid gap-3 rounded-xl border p-3 sm:grid-cols-[1fr_auto]">
    <div className="grid gap-2"><p className="text-sm font-medium">{index + 1}. {formatSeriesTime(row.start)}</p><p className="text-xs text-muted-foreground">{row.session_name} · Ends {formatSeriesTime(row.end)}</p>{row.requires_overbook && <div className="grid gap-2"><Label htmlFor={`series-overbook-${index}`}>Overbooking reason for appointment {index + 1}</Label><Input id={`series-overbook-${index}`} maxLength={1000} value={row.overbook_reason} disabled={readOnly} onChange={(event) => onChange(rows.map((line, i) => i === index ? { ...line, overbook_reason: event.target.value } : line))} /></div>}</div>
    {!readOnly && <Button type="button" variant="ghost" size="sm" aria-label={`Remove appointment ${index + 1}`} onClick={() => onChange(rows.filter((_, i) => i !== index))}>Remove</Button>}
  </li>)}</ol>;
}
export function SeriesBookingDialog({ open, onClose, context }) {
  const [rows, setRows] = useState([]); const [review, setReview] = useState(false); const [validation, setValidation] = useState(null);
  const requestId = useRef(null); const action = useSeriesWrite('create');
  const frozen = action.busy || action.unknown || Boolean(action.saved);
  const change = (next) => { if (frozen) return; requestId.current = crypto.randomUUID(); setRows(next); setValidation(null); };
  const close = () => { if (!action.busy) onClose(); };
  const payload = () => buildSeriesPayload(context, rows, requestId.current);
  const beginReview = () => { try { payload(); setValidation(null); setReview(true); } catch (error) { setValidation(error.message); } };
  const submit = async () => {
    if (action.busy || action.saved || !review) return;
    if (action.unknown) { await action.submit(); return; }
    try { await action.submit(payload()); } catch (error) { setValidation(error.message); }
  };
  return <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl">
    <DialogHeader><DialogTitle>{action.saved ? 'Appointments booked' : 'Book several appointments'}</DialogTitle><DialogDescription>{context.patientName} · {context.clinicName} · {context.serviceName}. Select 2 to 50 real session slots within 180 days. They are booked together after final review.</DialogDescription></DialogHeader>
    {action.saved ? <><Alert role="status"><AlertTitle>{action.recovered ? 'Saved booking found' : 'Booking confirmed'}</AlertTitle><AlertDescription>{action.recovered ? 'The original booking request is saved. The appointments below show their current times and statuses, including any later changes.' : `The server confirmed this group of ${action.saved.occurrence_count} appointments. The statuses below reflect the saved group.`}</AlertDescription></Alert><SeriesMembers series={action.saved} /><Link className="text-sm font-medium text-primary underline" to={`/appointments/series/${action.saved.id}`}>Review this appointment group</Link></> : <>
      {open && !review && <SeriesSlotPicker context={context} rows={rows} disabled={frozen} onAdd={(slot) => change([...rows, slot].sort((a, b) => Date.parse(a.start) - Date.parse(b.start)))} />}
      <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-medium">{review ? 'Review every appointment' : 'Selected appointments'} · {rows.length} / 50</h3>{review && <p className="text-xs text-muted-foreground">Times are shown in UTC</p>}</div>
      <DraftMembers rows={rows} readOnly={review || frozen} onChange={change} />
      {review && <p className="text-sm text-muted-foreground">Every slot is checked again at confirmation. If any slot cannot be booked safely, none of the appointments in this request is created. This group does not create automatic future bookings or waitlist entries.</p>}
      {(validation || action.error) && <Alert variant="destructive"><AlertTitle>{action.unknown ? 'Booking status unknown' : 'Appointments not booked'}</AlertTitle><AlertDescription>{validation || action.error.message}</AlertDescription></Alert>}
      {action.unknown && <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={action.busy} onClick={() => action.recover(requestId.current)}>Check saved booking</Button><Button type="button" disabled={action.busy} onClick={submit}>Retry same booking request</Button></div>}
    </>}
    <DialogFooter className="sticky -bottom-6 border-t bg-background py-4"><Button type="button" variant="outline" disabled={action.busy} onClick={close}>{action.saved ? 'Done' : 'Close booking'}</Button>{!action.saved && !action.unknown && (review ? <><Button type="button" variant="outline" disabled={action.busy} onClick={() => setReview(false)}>Change selection</Button><Button type="button" disabled={action.busy} onClick={submit}>{action.busy ? 'Booking…' : 'Confirm all appointments'}</Button></> : <Button type="button" onClick={beginReview} disabled={rows.length < 2 || action.busy}>Review appointments</Button>)}</DialogFooter>
  </DialogContent></Dialog>;
}
