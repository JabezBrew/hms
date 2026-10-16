import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { courseApi } from '@/features/pharmacy/prescribing/courseApi';
import { LabOrderActionBlock } from './WardRoundActions';

function Field({ row, field, label, onChange, type = 'text', required = false }) {
  const id = `${row.id}-${field}`;
  const raw = row[field] ?? '';
  const value = type === 'datetime-local' && /Z$/.test(raw) && Number.isFinite(Date.parse(raw)) ? new Date(Date.parse(raw) - new Date(raw).getTimezoneOffset() * 60000).toISOString().slice(0, 23) : raw;
  return <div className="space-y-1.5"><Label htmlFor={id}>{label}{required ? ' *' : ''}</Label><Input id={id} type={type} step={type === 'datetime-local' ? '0.001' : undefined} value={value} onChange={(event) => onChange(row.id, { [field]: event.target.value })} /></div>;
}
function MedicationCommands({ patientId, items, onChange, candidates, onDenied }) {
  const [error, setError] = useState(null); const [reading, setReading] = useState(null); const pending = useRef(null);
  useEffect(() => () => pending.current?.abort(), []);
  const update = (id, patch) => onChange(items.map((row) => row.id === id ? { ...row, ...patch } : row));
  const selectExisting = async (candidate) => {
    if (pending.current || items.some((row) => row.prescription_id === candidate.id)) return;
    const controller = new AbortController(); pending.current = controller; setReading(candidate.id); setError(null);
    try {
      const current = await courseApi.detail(candidate.id, patientId, { signal: controller.signal });
      if (controller.signal.aborted) return;
      onChange((rows) => [...rows, { id: crypto.randomUUID(), prescription_id: current.id, expected_snapshot_token: current.snapshot_token, medication_name: current.medication_name, dose: current.dose, frequency: current.frequency, route: current.route, status: current.status, source_status: current.status }]);
    } catch (failure) { if (!controller.signal.aborted) { if (failure.status === 403) onDenied?.(); else setError('The current prescription could not be loaded. Refresh before adding its decision.'); } }
    finally { if (pending.current === controller) { pending.current = null; if (!controller.signal.aborted) setReading(null); } }
  };
  return <section className="space-y-4 rounded-xl border bg-card p-4 sm:p-5"><div><h3 className="font-heading text-lg">Prescription decisions</h3><p className="mt-1 text-sm text-muted-foreground">Scheduled free-text starts and current-order status decisions. Use the prescription panel for as-needed policies, linked stock, replacement or renewal.</p></div>
    {candidates?.length > 0 && <div className="space-y-2"><p className="text-xs text-muted-foreground">Current-order preview · each selection loads its protected source</p><div className="flex flex-wrap gap-2">{candidates.map((row) => <Button key={row.id} size="sm" variant="outline" disabled={Boolean(reading) || items.some((item) => item.prescription_id === row.id)} onClick={() => selectExisting(row)}>{reading === row.id ? 'Loading current order…' : `Review ${row.medication_name || row.name}`}</Button>)}</div></div>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {items.map((row) => <div key={row.id} className="space-y-4 rounded-lg border bg-muted/20 p-4">{row.prescription_id ? <><p className="font-medium">{row.medication_name}</p><p className="text-sm text-muted-foreground">{row.dose} · {row.route} · {row.frequency}</p><div className="space-y-1.5"><Label htmlFor={`${row.id}-status`}>Reviewed status decision</Label><Select value={row.status} onValueChange={(value) => update(row.id, { status: value })}><SelectTrigger id={`${row.id}-status`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="on_hold">On hold</SelectItem><SelectItem value="stopped">Stopped</SelectItem><SelectItem value="completed">Completed</SelectItem></SelectContent></Select></div><p className="text-xs text-muted-foreground">The server checks the exact reviewed source and its lifecycle. A terminal course cannot be restarted here.</p></> : <><div className="grid gap-4 sm:grid-cols-2"><Field row={row} field="medication_name" label="Medication name" required onChange={update} /><Field row={row} field="dose" label="Dose" required onChange={update} /><Field row={row} field="route" label="Route" required onChange={update} /><Field row={row} field="frequency" label="Frequency" required onChange={update} /><Field row={row} field="start_date" label="Start date" type="date" required onChange={update} /><Field row={row} field="duration_days" label="Duration in days (optional)" type="number" onChange={update} /><Field row={row} field="first_dose_at" label="First dose time (optional, local)" type="datetime-local" onChange={update} /></div><div className="space-y-1.5"><Label htmlFor={`${row.id}-instructions`}>Instructions</Label><Textarea id={`${row.id}-instructions`} value={row.instructions ?? ''} onChange={(event) => update(row.id, { instructions: event.target.value })} /></div><Field row={row} field="reason" label="Prescribing reason" onChange={update} /></>}
      <Button size="sm" variant="ghost" onClick={() => onChange(items.filter((item) => item.id !== row.id))}>Remove prescription decision</Button></div>)}
    <Button variant="outline" onClick={() => onChange([...items, { id: crypto.randomUUID(), medication_name: '', dose: '', route: '', frequency: '', instructions: '', reason: '', start_date: '', duration_days: '' }])}>Add scheduled prescription</Button>
  </section>;
}
function NursingCommands({ items, onChange }) {
  const update = (id, patch) => onChange(items.map((row) => row.id === id ? { ...row, ...patch } : row));
  return <section className="space-y-4 rounded-xl border bg-card p-4 sm:p-5"><div><h3 className="font-heading text-lg">Nursing tasks</h3><p className="mt-1 text-sm text-muted-foreground">Review instructions and a due time. Tasks are created in the selected admission's current ward.</p></div>{items.map((row) => <div key={row.id} className="space-y-3 rounded-lg border p-4"><Field row={row} field="title" label="Task title" required onChange={update} /><div className="space-y-1.5"><Label htmlFor={`${row.id}-instruction`}>Task instructions *</Label><Textarea id={`${row.id}-instruction`} value={row.instruction} onChange={(event) => update(row.id, { instruction: event.target.value })} /></div><Field row={row} field="due_at" label="Due time (local)" type="datetime-local" required onChange={update} /><Button size="sm" variant="ghost" onClick={() => onChange(items.filter((item) => item.id !== row.id))}>Remove nursing task</Button></div>)}<Button variant="outline" onClick={() => onChange([...items, { id: crypto.randomUUID(), title: '', instruction: '', due_at: '' }])}>Add nursing task</Button></section>;
}
export function RoundCommandActions({ form, setForm, permissions, medications, onDenied }) {
  const patch = (key) => (value) => setForm((old) => ({ ...old, [key]: typeof value === 'function' ? value(old[key]) : value }));
  return <div className="space-y-4">{permissions.can_add_prescription && <MedicationCommands patientId={form.patientId} items={form.medications} onChange={patch('medications')} candidates={medications || []} onDenied={onDenied} />}
    {permissions.can_order_labs && <section className="space-y-3"><LabOrderActionBlock labOrders={form.labOrders} onChange={(labOrders) => setForm((old) => ({ ...old, labOrders, labExpandedTargets: [] }))} /><div className="space-y-1.5"><Label htmlFor="round-lab-priority">Laboratory priority</Label><Select value={form.labPriority} onValueChange={patch('labPriority')}><SelectTrigger id="round-lab-priority"><SelectValue /></SelectTrigger><SelectContent>{['routine', 'urgent', 'stat'].map((priority) => <SelectItem key={priority} value={priority}>{priority}</SelectItem>)}</SelectContent></Select></div>{form.labExpandedTargets.length > 0 && <div className="rounded-lg border p-3"><p className="text-xs font-medium">Reviewed panel tests</p><ul className="mt-2 space-y-1 text-sm text-muted-foreground">{form.labExpandedTargets.map((row) => <li key={`${row.resource_type}:${row.resource_id}`}>{row.display_name}{row.code ? ` · ${row.code}` : ''}</li>)}</ul></div>}</section>}
    {permissions.can_create_nursing_task && <NursingCommands items={form.nursingTasks} onChange={patch('nursingTasks')} />}
    {permissions.can_request_discharge && <section className="space-y-3 rounded-xl border bg-card p-4 sm:p-5"><h3 className="font-heading text-lg">Discharge request</h3><div className="flex items-start gap-3"><Checkbox id="round-request-discharge" checked={form.discharge.request_discharge} onCheckedChange={(value) => patch('discharge')({ ...form.discharge, request_discharge: value === true })} /><Label htmlFor="round-request-discharge" className="text-sm leading-6">Create a discharge request with this round</Label></div><p className="text-sm text-muted-foreground">Normal source-driven clinical, billing and pharmacy checks still apply. This action does not complete the discharge.</p></section>}
  </div>;
}
