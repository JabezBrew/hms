import { useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useScopedNotifications } from '@/shared/hooks/useScopedNotifications';
import { organizationApi } from '../api';
import { errorCopy, prepareCommand, UNIT_TYPES } from '../model';
import { ParentPicker } from './ParentPicker';
import { parentLabel } from '../model';
const titles = { create: 'Create organization unit', rename: 'Rename organization unit', retire: 'Retire organization unit', reactivate: 'Reactivate organization unit' };
function SavedResult({ controller, canWrite, canRecover, onDone, finishing }) {
  const receipt = controller.saved;
  return <div className="grid gap-4"><Alert><AlertTitle>{receipt ? 'Original change confirmed' : 'Change needs reconciliation'}</AlertTitle><AlertDescription>{receipt ? <><p>{receipt.unit.name} ({receipt.unit.code}) · {receipt.unit.is_active ? 'Active' : 'Inactive'} · Version {receipt.unit.version}</p><p>{receipt.changed ? 'The reviewed change was recorded.' : 'The reviewed request was recorded without changing the unit.'}</p></> : 'A reply was lost or could not be validated. The original request stays fixed. Current directory entries cannot establish its outcome.'}</AlertDescription></Alert>
    {controller.error && <p role="alert" className="text-sm text-destructive">{controller.error}</p>}
    {controller.refreshFailed && <p role="alert">The original result is confirmed, but the directory could not be refreshed. Refresh before another change.</p>}
    {receipt ? <Button type="button" onClick={onDone} disabled={controller.busy || finishing}>Refresh directory and finish review</Button> : <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={!canRecover || controller.busy} onClick={() => controller.run(null, true)}>Check original result</Button><Button type="button" disabled={!canWrite || controller.busy} onClick={() => controller.run()}>Retry unchanged reviewed change</Button></div>}
    {!canWrite && <p className="text-sm text-muted-foreground">Current access is read-only. A privileged command or original receipt requires current server confirmation.</p>}
  </div>;
}
function ReviewEvidence({ review }) {
  const { input, previous, parent } = review;
  return <div className="grid gap-3 rounded-xl border bg-muted/30 p-4"><h3 className="font-medium">Review exact change</h3>{previous && <p className="break-words">Current unit: {previous.name} ({previous.code}) · Version {previous.version} · {previous.is_active ? 'Active' : 'Inactive'}</p>}
    {input.action === 'create' ? <><p className="break-words">{input.name} ({input.code}) · {UNIT_TYPES[input.unit_type]}</p><p className="break-words">Parent: {parent ? `${parent.name} (${parent.code})` : 'No parent unit'}</p><p className="text-sm text-muted-foreground">Code, type and parent are permanent. Creating a unit does not assign staff, appointments, coverage or permissions.</p></> : <><p>Parent: {parentLabel(previous)}</p>{input.action === 'rename' ? <p className="break-words">New name: {input.name}</p> : <p className="text-sm">{input.action === 'retire' ? 'Retirement keeps this unit and its history. Child units, positions or scoped permissions, including inactive or historical references, prevent this change here. Closing or revoking them does not remove their history.' : 'Reactivation requires an active retained parent. Recorded child units, positions or scoped permissions, including inactive or historical references, prevent this change here. Closing or revoking them does not remove their history. Restoring legacy authority is unavailable in this workflow.'}</p>}</>}
  </div>;
}
export function OrganizationChangeDialog({ selection, open, onClose, access, controller, onDenied, onDone, finishing, sourceToken }) {
  const [fields, setFields] = useState({ name: selection.unit?.name || '', code: '', unit_type: '', parent: null });
  const [review, setReview] = useState(null), [consent, setConsent] = useState(false), [error, setError] = useState(null), [preparing, setPreparing] = useState(false);
  const operation = useRef(null), capture = useScopedNotifications(access.scope);
  const source = useRef(sourceToken), sourceEpoch = useRef(0);
  useLayoutEffect(() => { if (source.current !== sourceToken) { source.current = sourceToken; sourceEpoch.current++; setReview(null); setConsent(false); } }, [sourceToken]);
  useLayoutEffect(() => { if (controller.error && !controller.unknown) { setReview(null); setConsent(false); } }, [controller.error, controller.unknown]);
  useLayoutEffect(() => () => operation.current?.abort(), []);
  const change = patch => { setFields(old => ({ ...old, ...patch })); setReview(null); setConsent(false); setError(null); };
  const prepare = async event => {
    event.preventDefault(); if (operation.current || controller.locked || !access.canWrite) return;
    const lease = capture(), epoch = sourceEpoch.current, abort = new AbortController(); operation.current = abort; setPreparing(true); setReview(null); setConsent(false); setError(null);
    try {
      let previous = null, parent = null;
      if (selection.action === 'create') {
        if (!fields.parent || !fields.unit_type) throw new Error('Choose an explicit unit type and parent choice.');
        if (fields.parent.choice === 'unit') { parent = await organizationApi.get(fields.parent.unit.id, { signal: abort.signal }); if (!parent.is_active) throw new Error('The selected parent is inactive. Choose a current active parent.'); }
      } else previous = await organizationApi.get(selection.unit.id, { signal: abort.signal });
      const input = selection.action === 'create' ? { action: 'create', client_request_id: crypto.randomUUID(), code: fields.code, name: fields.name, unit_type: fields.unit_type, parent_unit_id: parent?.id || null } : { action: selection.action, client_request_id: crypto.randomUUID(), unit_id: previous.id, expected_version: previous.version, ...(selection.action === 'rename' ? { name: fields.name } : {}) };
      const command = await prepareCommand(input, access.user.id, previous);
      if (!abort.signal.aborted && lease.isCurrent()) { if (epoch === sourceEpoch.current) setReview({ ...command, parent }); else setError('The directory changed during review. Refresh and review this change again.'); }
    } catch (failure) { if (!abort.signal.aborted && lease.isCurrent()) { if (failure.status === 403) onDenied(); else setError(failure.status ? errorCopy(failure) : failure.message); } }
    finally { if (operation.current === abort) operation.current = null; if (!abort.signal.aborted && lease.isCurrent()) setPreparing(false); }
  };
  const busy = preparing || controller.busy || finishing;
  return <Dialog open={open} onOpenChange={next => { if (!next && !busy) onClose(); }}><DialogContent className="flex max-h-[92dvh] min-w-0 flex-col overflow-hidden sm:max-w-2xl" onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onInteractOutside={event => { if (busy) event.preventDefault(); }}><DialogHeader><DialogTitle>{titles[selection.action]}</DialogTitle><DialogDescription>Review a current exact unit before submitting. Staff membership, leadership, coverage and clinical service links are managed separately.</DialogDescription></DialogHeader>
    <div className="min-h-0 flex-1 overflow-y-auto pr-1">{controller.unknown || controller.saved ? <SavedResult {...{ controller, canWrite: access.canWrite, canRecover: access.canRecover }} onDone={onDone} finishing={finishing} /> : <form id="organization-change" onSubmit={prepare} className="grid gap-5">
      {(selection.action === 'create' || selection.action === 'rename') && <div className="grid gap-2"><Label htmlFor="organization-name">Unit name</Label><Input id="organization-name" value={fields.name} onChange={event => change({ name: event.target.value })} disabled={busy} required autoComplete="off" /><p className="text-xs text-muted-foreground">Up to 160 UTF-8 bytes; no control characters.</p></div>}
      {selection.action === 'create' && <><div className="grid gap-2"><Label htmlFor="organization-code">Permanent code</Label><Input id="organization-code" value={fields.code} onChange={event => change({ code: event.target.value })} disabled={busy} required maxLength={48} pattern="[A-Za-z0-9_-]+" autoComplete="off" /><p className="text-xs text-muted-foreground">Up to 48 letters, numbers, underscores or hyphens.</p></div><div className="grid gap-2"><Label htmlFor="organization-type">Permanent unit type</Label><Select value={fields.unit_type} onValueChange={unit_type => change({ unit_type })} disabled={busy}><SelectTrigger id="organization-type"><SelectValue placeholder="Choose a type" /></SelectTrigger><SelectContent><SelectGroup>{Object.entries(UNIT_TYPES).map(([value,label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectGroup></SelectContent></Select></div><ParentPicker scope={access.scope} enabled={open} selected={fields.parent} onSelect={parent => change({ parent })} disabled={busy} onDenied={onDenied} /></>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}{controller.error && <p role="alert" className="text-sm text-destructive">{controller.error}</p>}
      {review && <><ReviewEvidence review={review} /><label className="flex items-start gap-3 text-sm"><Checkbox checked={consent} onCheckedChange={value => setConsent(value === true)} disabled={busy} aria-label="I reviewed this exact organization change" /><span>I reviewed this exact change and its current unit version.</span></label></>}
    </form>}</div>
    <DialogFooter className="shrink-0 flex-wrap gap-2 border-t pt-4">{!controller.locked && <Button type="submit" form="organization-change" variant="outline" disabled={busy || !access.canWrite}>{preparing ? 'Confirming current unit…' : 'Refresh and review change'}</Button>}{review && !controller.locked && <Button type="button" disabled={busy || !consent || !access.canWrite} onClick={() => controller.run(review)}>Confirm reviewed change</Button>}<Button type="button" variant="outline" disabled={busy} onClick={onClose}>Close review</Button></DialogFooter>
  </DialogContent></Dialog>;
}
