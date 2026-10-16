import { useId, useRef, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { StandingChoicePicker } from './StandingChoicePicker';
import { useStandingWrite } from './hooks';
import { StandingTemplateSaved } from './StandingTemplateSummary';

function initialDraft(template) {
  return {
    name: template?.name || '', frequency: template?.frequency || 'weekly', next_run_on: template?.next_run_on || new Date().toISOString().slice(0, 10), monthly_day: String(template?.monthly_day || 1), notes: template?.notes || '',
    requesting: template ? { id: template.requesting_location_id, name: template.requesting_location_name } : null,
    fulfilling: template ? { id: template.fulfilling_location_id, name: template.fulfilling_location_name } : null,
    items: (template?.items || []).map((item) => ({ ...item, rowId: item.id, name: item.item_name, code: item.item_code })),
  };
}
function monthlyDate(value, day) {
  const first = new Date(`${value.slice(0, 7)}-01T00:00:00Z`);
  if (!Number.isFinite(first.getTime()) || !Number.isInteger(Number(day)) || Number(day) < 1 || Number(day) > 31) return value;
  first.setUTCMonth(first.getUTCMonth() + 1, 0);
  return `${value.slice(0, 7)}-${String(Math.min(Number(day), first.getUTCDate())).padStart(2, '0')}`;
}
export function standingTemplatePayload(draft) {
  const bytes = (text) => new TextEncoder().encode(text).length;
  if (!draft.name.trim() || Array.from(draft.name.trim()).length > 100) throw new Error('Enter a shorter template name.');
  if (!draft.requesting?.id || !draft.fulfilling?.id || draft.requesting.id === draft.fulfilling.id) throw new Error('Choose two different facility locations.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.next_run_on)) throw new Error('Choose the first due date in UTC.');
  if (bytes(draft.notes) > 1000) throw new Error('Stock handling notes are too long. Shorten them.');
  if (!draft.items.length || draft.items.length > 100 || new Set(draft.items.map((item) => item.item_id)).size !== draft.items.length) throw new Error('Choose 1 to 100 different inventory items.');
  const items = draft.items.map((item) => {
    const quantity = Number(item.quantity);
    if (!item.item_id || !Number.isSafeInteger(quantity) || quantity <= 0) throw new Error('Every item needs a positive whole-number quantity.');
    if (!(item.current_unit || item.unit)) throw new Error('Reselect the catalog item to confirm its unit.');
    return { item_id: item.item_id, quantity, expected_unit: item.current_unit || item.unit };
  });
  const monthly = draft.frequency === 'monthly';
  const day = Number(draft.monthly_day);
  if (monthly && (!Number.isInteger(day) || day < 1 || day > 31)) throw new Error('Choose a monthly day from 1 to 31.');
  if (monthly && monthlyDate(draft.next_run_on, day) !== draft.next_run_on) throw new Error('Set the next due date to the monthly day, or the last day of a shorter month.');
  return { name: draft.name.trim(), requesting_location_id: draft.requesting.id, fulfilling_location_id: draft.fulfilling.id, frequency: draft.frequency, next_run_on: draft.next_run_on, monthly_day: monthly ? day : null, notes: draft.notes.trim() || null, items };
}
function TemplateLines({ draft, update, disabled }) {
  const replace = (rowId, patch) => update({ items: draft.items.map((item) => item.rowId === rowId ? { ...item, ...patch } : item) });
  return <fieldset disabled={disabled} className="grid gap-4"><legend className="mb-3 text-sm font-medium">Requested items</legend>
    {draft.items.map((item, index) => <section key={item.rowId} className="grid gap-3 rounded-xl border p-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto]">
      <StandingChoicePicker kind="items" label={`Item ${index + 1}`} value={item.item_id ? { name: `${item.name} · ${item.unit}` } : null} excludedIds={draft.items.filter((line) => line.rowId !== item.rowId).map((line) => line.item_id)} disabled={disabled} onSelect={(selected) => replace(item.rowId, { item_id: selected.id, name: selected.name, code: selected.code, unit: selected.id === item.item_id ? item.unit : selected.unit, current_unit: selected.unit, ...(item.item_id && selected.id !== item.item_id ? { quantity: '' } : {}) })} />
      <div className="grid content-start gap-2"><Label htmlFor={`${item.rowId}-quantity`}>Quantity{item.unit ? ` (${item.current_unit || item.unit})` : ''}</Label><Input id={`${item.rowId}-quantity`} type="number" min="1" step="1" required value={item.quantity} disabled={disabled} onChange={(event) => replace(item.rowId, { quantity: event.target.value })} />{item.current_unit && item.current_unit !== item.unit && <p className="text-xs text-destructive">Saved unit {item.unit}; current unit {item.current_unit}. Review the quantity.</p>}</div>
      <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => update({ items: draft.items.filter((line) => line.rowId !== item.rowId) })} aria-label={`Remove item ${index + 1}`}>Remove</Button>
    </section>)}
    <Button type="button" variant="outline" disabled={disabled || draft.items.length >= 100} onClick={() => update({ items: [...draft.items, { rowId: crypto.randomUUID(), item_id: '', name: '', unit: '', quantity: '1' }] })}>Add item</Button>
    <p className="text-xs text-muted-foreground">Choose exact active catalog products and their units. Controlled items require their dedicated workflow. Saving a template does not reserve or move stock.</p>
  </fieldset>;
}
export function StandingTemplateFormDialog({ template, onClose }) {
  const id = useId();
  const [draft, setDraft] = useState(() => initialDraft(template));
  const [validation, setValidation] = useState(null);
  const [unitsReviewed, setUnitsReviewed] = useState(false);
  const saving = useRef(false);
  const action = useStandingWrite(template ? 'update' : 'create');
  const unknown = action.error?.code === 'standing_write_unconfirmed';
  const locked = action.isPending || unknown || Boolean(action.data);
  const changedUnits = draft.items.some((item) => item.current_unit && item.current_unit !== item.unit);
  const update = (patch) => { setDraft((value) => ({ ...value, ...patch })); setValidation(null); if ('items' in patch) setUnitsReviewed(false); };
  const close = () => { if (!action.isPending) onClose(); };
  const submit = async (event) => {
    event.preventDefault(); if (saving.current || locked) return;
    let payload;
    try { payload = standingTemplatePayload(draft); if (changedUnits && !unitsReviewed) throw new Error('Review the changed units and quantities before saving.'); }
    catch (error) { setValidation(error.message); return; }
    saving.current = true;
    try { await action.mutateAsync(template ? [template.id, { expected_version: template.version, template: payload }] : [payload]); }
    catch { /* Inline status retains unknown outcomes and never auto-retries. */ }
    finally { saving.current = false; }
  };
  return <Dialog open onOpenChange={(open) => { if (!open) close(); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl">
    <DialogHeader><DialogTitle>{action.data ? 'Standing template saved' : template ? 'Edit standing template' : 'New standing template'}</DialogTitle><DialogDescription>Configure a recurring stock request. Generate each due request when ready; requests are not created automatically.</DialogDescription></DialogHeader>
    {action.data ? <><StandingTemplateSaved template={action.data} /><DialogFooter><Button type="button" onClick={close}>Done</Button></DialogFooter></> : <form onSubmit={submit} className="grid gap-5">
      <fieldset disabled={locked} className="grid gap-4"><legend className="sr-only">Template configuration</legend>
        <div className="grid gap-2"><Label htmlFor={`${id}-name`}>Template name</Label><Input id={`${id}-name`} value={draft.name} maxLength={100} required onChange={(event) => update({ name: event.target.value })} /></div>
        <div className="grid gap-4 md:grid-cols-2"><StandingChoicePicker kind="locations" label="Requesting location" value={draft.requesting} excludedIds={draft.fulfilling ? [draft.fulfilling.id] : []} onSelect={(requesting) => update({ requesting })} disabled={locked} /><StandingChoicePicker kind="locations" label="Fulfilling location" value={draft.fulfilling} excludedIds={draft.requesting ? [draft.requesting.id] : []} onSelect={(fulfilling) => update({ fulfilling })} disabled={locked} /></div>
        <div className="grid gap-4 sm:grid-cols-3"><div className="grid gap-2"><Label htmlFor={`${id}-frequency`}>Frequency</Label><Select value={draft.frequency} disabled={locked} onValueChange={(frequency) => update({ frequency, ...(frequency === 'monthly' ? { monthly_day: String(Number(draft.next_run_on.slice(-2)) || 1) } : {}) })}><SelectTrigger id={`${id}-frequency`}><SelectValue /></SelectTrigger><SelectContent>{['daily', 'weekly', 'biweekly', 'monthly'].map((value) => <SelectItem key={value} value={value}>{value === 'biweekly' ? 'Every two weeks' : value.charAt(0).toUpperCase() + value.slice(1)}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-2"><Label htmlFor={`${id}-date`}>Next due date (UTC)</Label><Input id={`${id}-date`} type="date" required value={draft.next_run_on} onChange={(event) => update({ next_run_on: event.target.value, ...(draft.frequency === 'monthly' ? { monthly_day: String(Number(event.target.value.slice(-2)) || 1) } : {}) })} /></div>{draft.frequency === 'monthly' && <div className="grid gap-2"><Label htmlFor={`${id}-day`}>Monthly day</Label><Input id={`${id}-day`} type="number" min="1" max="31" required value={draft.monthly_day} onChange={(event) => update({ monthly_day: event.target.value, next_run_on: monthlyDate(draft.next_run_on, event.target.value) })} /></div>}</div>
        {draft.frequency === 'monthly' && <p className="text-xs text-muted-foreground">Shorter months use their last day and retain this monthly day for later months.</p>}
        <TemplateLines draft={draft} update={update} disabled={locked} />
        {changedUnits && <div className="flex items-start gap-3"><Checkbox id={`${id}-units`} checked={unitsReviewed} onCheckedChange={(checked) => setUnitsReviewed(checked === true)} disabled={locked} /><Label htmlFor={`${id}-units`} className="leading-relaxed">I reviewed quantities using the current catalog units shown above.</Label></div>}
        <div className="grid gap-2"><Label htmlFor={`${id}-notes`}>Stock handling notes (optional)</Label><Textarea id={`${id}-notes`} value={draft.notes} maxLength={1000} onChange={(event) => update({ notes: event.target.value })} /></div>
      </fieldset>
      {(validation || action.error) && <Alert variant="destructive"><AlertTitle>{unknown ? 'Save status unknown' : 'Template not saved'}</AlertTitle><AlertDescription>{validation || action.error.message}</AlertDescription></Alert>}
      <DialogFooter className="sticky -bottom-6 border-t bg-background py-4"><Button type="button" variant="outline" disabled={action.isPending} onClick={close}>{unknown ? 'Close and review templates' : 'Cancel'}</Button><Button type="submit" disabled={locked || (changedUnits && !unitsReviewed)}>{action.isPending ? 'Saving…' : 'Save template'}</Button></DialogFooter>
    </form>}
  </DialogContent></Dialog>;
}
