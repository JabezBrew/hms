import { useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useScopedNotifications } from '@/shared/hooks/useScopedNotifications';
import { storageLocationApi } from '../api';
import { errorCopy, prepareCommand, validName, LOCATION_TYPES, TEMPERATURE_ZONES } from '../model';

const titles = { create: 'Create storage location', rename: 'Rename storage location', retire: 'Retire storage location', reactivate: 'Reactivate storage location' };
function SavedResult({ controller, canWrite, canRecover, onDone, finishing }) {
  const receipt = controller.saved;
  return <div className="grid gap-4"><Alert><AlertTitle>{receipt ? 'Original change confirmed' : 'Change needs reconciliation'}</AlertTitle><AlertDescription>{receipt ? <><p>{receipt.location.name} ({receipt.location.code}) · {receipt.location.is_active ? 'Active' : 'Inactive'} · Version {receipt.location.version}</p><p>{receipt.changed ? 'The reviewed change was recorded.' : 'The reviewed request was recorded without changing the location.'}</p></> : 'A reply was lost or could not be validated. The original request stays fixed. Current directory entries cannot establish its outcome.'}</AlertDescription></Alert>
    {controller.error && <p role="alert" className="text-sm text-destructive">{controller.error}</p>}
    {controller.refreshFailed && <p role="alert">The original result is confirmed, but the directory could not be refreshed. Refresh before another change.</p>}
    {receipt ? <Button type="button" onClick={onDone} disabled={controller.busy || finishing}>Refresh directory and finish review</Button> : <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={!canRecover || controller.busy} onClick={() => controller.run(null, true)}>Check original result</Button><Button type="button" disabled={!canWrite || controller.busy} onClick={() => controller.run()}>Retry unchanged reviewed change</Button></div>}
    {!canWrite && <p className="text-sm text-muted-foreground">Current access is read-only. Changes require management authority and current credentials. Original receipts also require current server-confirmed credentials.</p>}
  </div>;
}
function ReviewEvidence({ review }) {
  const { input, previous } = review;
  return <div className="grid gap-3 rounded-xl border bg-muted/30 p-4"><h3 className="font-medium">Review exact change</h3>{previous && <p className="break-words">Current location: {previous.name} ({previous.code}) · Version {previous.version} · {previous.is_active ? 'Active' : 'Inactive'}</p>}
    {input.action === 'create' ? <><p className="break-words">{input.name} ({input.code}) · {LOCATION_TYPES[input.location_type]} · {TEMPERATURE_ZONES[input.temperature_zone]}</p><p className="text-sm text-muted-foreground">Code, type and temperature zone are permanent. Creating a location does not allocate stock or grant access.</p></> : <><p className="break-words">Permanent classification: {LOCATION_TYPES[previous.location_type] || previous.location_type} · {TEMPERATURE_ZONES[previous.temperature_zone] || previous.temperature_zone}</p>{input.action === 'rename' ? <p className="break-words">New name: {input.name}. Existing stock and operational history are preserved.</p> : <p className="text-sm">{input.action === 'retire' ? 'Retirement keeps the location and its history. Only an unused location can be retired here.' : 'Only an unused location can be reactivated here.'} Recorded stock or operational history, including zero-balance and completed records, prevents this active-state change. Used-location closeout is unavailable in this workflow.</p>}</>}
  </div>;
}
export function StorageLocationChangeDialog({ selection, open, onClose, access, controller, onDenied, onDone, finishing, sourceToken }) {
  const [fields, setFields] = useState({ name: selection.location?.name || '', code: '', location_type: '', temperature_zone: '' });
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
      if (['create', 'rename'].includes(selection.action) && !validName(fields.name)) throw new Error('Use a name of up to 160 UTF-8 bytes, without leading or trailing spaces or control characters.');
      let previous = null;
      if (selection.action === 'create') {
        if (!fields.location_type || !fields.temperature_zone) throw new Error('Choose an explicit location type and temperature zone.');
        if (!/^[A-Za-z0-9_-]{1,48}$/.test(fields.code)) throw new Error('Use a permanent code of up to 48 letters, numbers, underscores or hyphens.');
      } else previous = await storageLocationApi.get(selection.location.id, { signal: abort.signal });
      const input = selection.action === 'create' ? { action: 'create', client_request_id: crypto.randomUUID(), code: fields.code, name: fields.name, location_type: fields.location_type, temperature_zone: fields.temperature_zone } : { action: selection.action, client_request_id: crypto.randomUUID(), location_id: previous.id, expected_version: previous.version, ...(selection.action === 'rename' ? { name: fields.name } : {}) };
      const command = await prepareCommand(input, access.user.id, previous);
      if (!abort.signal.aborted && lease.isCurrent()) { if (epoch === sourceEpoch.current) setReview(command); else setError('The directory changed during review. Refresh and review this change again.'); }
    } catch (failure) { if (!abort.signal.aborted && lease.isCurrent()) { if (failure.status === 403) onDenied(); else setError(failure.status ? errorCopy(failure) : failure.message); } }
    finally { if (operation.current === abort) operation.current = null; if (!abort.signal.aborted && lease.isCurrent()) setPreparing(false); }
  };
  const busy = preparing || controller.busy || finishing;
  return <Dialog open={open} onOpenChange={next => { if (!next && !busy) onClose(); }}><DialogContent className="flex max-h-[92dvh] min-w-0 flex-col overflow-hidden sm:max-w-2xl" onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onInteractOutside={event => { if (busy) event.preventDefault(); }}><DialogHeader><DialogTitle>{titles[selection.action]}</DialogTitle><DialogDescription>Review a current exact location before submitting. Code, location type and temperature zone stay unchanged after creation. Active status changes are limited to unused locations.</DialogDescription></DialogHeader>
    <div className="min-h-0 flex-1 overflow-y-auto pr-1">{controller.unknown || controller.saved ? <SavedResult {...{ controller, canWrite: access.canWrite, canRecover: access.canRecover }} onDone={onDone} finishing={finishing} /> : <form id="storage-location-change" onSubmit={prepare} className="grid gap-5">
      {(selection.action === 'create' || selection.action === 'rename') && <div className="grid gap-2"><Label htmlFor="storage-location-name">Location name</Label><Input id="storage-location-name" value={fields.name} onChange={event => change({ name: event.target.value })} disabled={busy} required autoComplete="off" /><p className="text-xs text-muted-foreground">Up to 160 UTF-8 bytes; no leading or trailing spaces or control characters.</p></div>}
      {selection.action === 'create' && <><div className="grid gap-2"><Label htmlFor="storage-location-code">Permanent code</Label><Input id="storage-location-code" value={fields.code} onChange={event => change({ code: event.target.value })} disabled={busy} required maxLength={48} pattern="[A-Za-z0-9_-]+" autoComplete="off" /><p className="text-xs text-muted-foreground">Up to 48 letters, numbers, underscores or hyphens.</p></div><div className="grid gap-2"><Label htmlFor="storage-location-type">Permanent location type</Label><Select value={fields.location_type} onValueChange={location_type => change({ location_type })} disabled={busy}><SelectTrigger id="storage-location-type"><SelectValue placeholder="Choose a type" /></SelectTrigger><SelectContent><SelectGroup>{Object.entries(LOCATION_TYPES).map(([value,label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectGroup></SelectContent></Select></div><div className="grid gap-2"><Label htmlFor="storage-location-temperature">Permanent temperature zone</Label><Select value={fields.temperature_zone} onValueChange={temperature_zone => change({ temperature_zone })} disabled={busy}><SelectTrigger id="storage-location-temperature"><SelectValue placeholder="Choose a temperature zone" /></SelectTrigger><SelectContent><SelectGroup>{Object.entries(TEMPERATURE_ZONES).map(([value,label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectGroup></SelectContent></Select><p className="text-xs text-muted-foreground">The controlled temperature zone is a storage classification; it does not grant controlled-substance authority.</p></div></>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}{controller.error && <p role="alert" className="text-sm text-destructive">{controller.error}</p>}
      {review && <><ReviewEvidence review={review} /><label className="flex items-start gap-3 text-sm"><Checkbox checked={consent} onCheckedChange={value => setConsent(value === true)} disabled={busy} aria-label="I reviewed this exact storage-location change" /><span>I reviewed this exact change and its current location version.</span></label></>}
    </form>}</div>
    <DialogFooter className="shrink-0 flex-wrap gap-2 border-t pt-4">{!controller.locked && <Button type="submit" form="storage-location-change" variant="outline" disabled={busy || !access.canWrite}>{preparing ? 'Confirming current location…' : 'Refresh and review change'}</Button>}{review && !controller.locked && <Button type="button" disabled={busy || !consent || !access.canWrite} onClick={() => controller.run(review)}>Confirm reviewed change</Button>}<Button type="button" variant="outline" disabled={busy} onClick={onClose}>Close review</Button></DialogFooter>
  </DialogContent></Dialog>;
}
