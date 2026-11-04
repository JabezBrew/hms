import { useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useReadOnlyMode } from '@/contexts/ReadOnlyModeContext';
import { networkDecisionDenialPending } from '@/features/settings/network/useNetworkDecisionExpired';
import { useScopedNotifications } from '@/shared/hooks/useScopedNotifications';
import { isCurrentReadDenial } from '@/lib/api/v2/readDenials';
import { serviceApi } from '../api';
import { errorCopy, prepareCommand, validName, validDuration } from '../model';
import { serviceCode, serviceName } from '../presentation';

const titles = { create: 'Add bookable service', metadata: 'Edit service details', retire: 'Retire bookable service', reactivate: 'Reactivate bookable service' };
function SavedResult({ controller, access, onDone, finishing }) {
  const receipt = controller.saved;
  return <div className="grid gap-4"><Alert><AlertTitle>{receipt ? 'Original change confirmed' : 'Change needs reconciliation'}</AlertTitle><AlertDescription>{receipt ? <><p>{serviceName(receipt.service)} ({serviceCode(receipt.service)}) · {receipt.service.default_duration_minutes} minutes · {receipt.service.is_active ? 'Active' : 'Retired'} · Version {receipt.service.version}</p><p>{receipt.changed ? 'The reviewed change was recorded.' : 'The service already matched the reviewed state. This request was recorded without changing it.'}</p></> : 'A reply was lost or could not be validated. The original request stays fixed. Current directory entries cannot establish its outcome.'}</AlertDescription></Alert>
    {controller.error && <p role="alert" className="text-sm text-destructive">{controller.error}</p>}{controller.refreshFailed && <p role="alert">The original result is confirmed, but the directory could not be refreshed. Refresh before another change.</p>}
    {receipt ? <Button type="button" onClick={onDone} disabled={controller.busy || finishing}>Refresh directory and finish review</Button> : <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={!access.canRecover || controller.busy} onClick={() => controller.run(null, true)}>Check original result</Button><Button type="button" disabled={!access.canWrite || controller.busy} onClick={() => controller.run()}>Retry unchanged reviewed change</Button></div>}
    {!access.canWrite && <p className="text-sm text-muted-foreground">Changes require current management authority, network access and server-confirmed credentials. Original receipts also require current credentials.</p>}
  </div>;
}
function ReviewEvidence({ review }) {
  const { input, previous } = review;
  return <div className="grid gap-3 rounded-xl border bg-muted/30 p-4"><h3 className="font-medium">Review exact change</h3>{previous && <p className="break-words">Current service: {serviceName(previous)} ({serviceCode(previous)}) · {previous.default_duration_minutes} minutes · Version {previous.version} · {previous.is_active ? 'Active' : 'Retired'}</p>}
    {input.action === 'create' ? <><p className="break-words">{input.name} ({input.code}) · {input.default_duration_minutes} minutes</p><p className="text-sm text-muted-foreground">The code is permanent. Creating a service does not book an appointment or grant access.</p></> : input.action === 'metadata' ? <><p className="break-words">New details: {input.name} · {input.default_duration_minutes} minutes.</p><p className="text-sm text-muted-foreground">The code remains {serviceCode(previous)}. Existing appointments keep their booked times.</p></> : <p className="text-sm">{input.action === 'retire' ? 'This service will stop being available for new bookings. Existing appointments keep their booked times and are not cancelled. Future-generating templates can prevent retirement.' : 'Make this service available for new bookings again. Existing appointment times remain recorded as booked.'}</p>}
  </div>;
}
export function ServiceChangeDialog({ selection, open, onClose, access, controller, onDenied, onDone, finishing, sourceToken }) {
  const [fields, setFields] = useState({ name: selection.service?.name || '', code: '', duration: selection.service ? String(selection.service.default_duration_minutes) : '' });
  const [review, setReview] = useState(null), [consent, setConsent] = useState(false), [error, setError] = useState(null), [preparing, setPreparing] = useState(false);
  const readClock = useRef(null), network = useReadOnlyMode({ optional: true });
  const operation = useRef(null), mounted = useRef(false), capture = useScopedNotifications(access.scope), source = useRef(sourceToken), sourceEpoch = useRef(0);
  useLayoutEffect(() => { if (source.current !== sourceToken) { source.current = sourceToken; sourceEpoch.current++; setReview(null); setConsent(false); } }, [sourceToken]);
  useLayoutEffect(() => { if (controller.error && !controller.unknown) { setReview(null); setConsent(false); } }, [controller.error, controller.unknown]);
  useLayoutEffect(() => { if (!access.canWrite) {
    const pending = operation.current;
    const observingDenial = pending && readClock.current?.operation === pending && networkDecisionDenialPending(readClock.current.decision);
    if (!observingDenial) { pending?.abort(); operation.current = null; readClock.current = null; setPreparing(false); }
    setReview(null); setConsent(false);
  } }, [access.canWrite, network?.networkDecision]);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current?.abort(); operation.current = null; readClock.current = null; }; }, []);
  const change = patch => { setFields(old => ({ ...old, ...patch })); setReview(null); setConsent(false); setError(null); };
  const metadata = ['create', 'metadata'].includes(selection.action);
  const prepare = async event => {
    event.preventDefault(); if (operation.current || controller.locked || !access.canWrite) return;
    const lease = capture(), epoch = sourceEpoch.current, abort = new AbortController(); operation.current = abort; readClock.current = { operation: abort, decision: network?.networkDecision }; setPreparing(true); setReview(null); setConsent(false); setError(null);
    try {
      if (metadata && !validName(fields.name)) throw new Error('Use a name of up to 160 UTF-8 bytes, without leading or trailing spaces or control characters.');
      const duration = Number(fields.duration);
      if (metadata && (!/^\d+$/.test(fields.duration) || !validDuration(duration))) throw new Error('Choose a whole default duration from 1 to 1440 minutes.');
      if (selection.action === 'create' && !/^[A-Za-z0-9_-]{1,48}$/.test(fields.code)) throw new Error('Use a permanent code of up to 48 letters, numbers, underscores or hyphens.');
      const previous = selection.action === 'create' ? null : await serviceApi.get(selection.service.id, { signal: abort.signal });
      const input = selection.action === 'create' ? { action: 'create', client_request_id: crypto.randomUUID(), code: fields.code, name: fields.name, default_duration_minutes: duration } : { action: selection.action, client_request_id: crypto.randomUUID(), service_id: previous.id, expected_version: previous.version, ...(metadata ? { name: fields.name, default_duration_minutes: duration } : {}) };
      const command = await prepareCommand(input, access.user.id, previous);
      if (!abort.signal.aborted && mounted.current && operation.current === abort && lease.isCurrent()) { if (epoch === sourceEpoch.current) setReview(command); else setError('The directory changed during review. Refresh and review this change again.'); }
    } catch (failure) {
      const currentDenial = !abort.signal.aborted && mounted.current && operation.current === abort && epoch === sourceEpoch.current && isCurrentReadDenial(failure);
      if (currentDenial) { if (failure.data?.error?.code === 'reauth_required') setError(errorCopy(failure)); else onDenied(); }
      else if (!abort.signal.aborted && mounted.current && operation.current === abort && lease.isCurrent()) setError(failure.status ? errorCopy(failure) : failure.message);
    }
    finally { if (operation.current === abort) { operation.current = null; readClock.current = null; if (mounted.current) setPreparing(false); } }
  };
  const locked = controller.busy || finishing;
  const busy = preparing || locked;
  const close = () => { if (locked) return; const pending = operation.current; operation.current = null; readClock.current = null; pending?.abort(); setPreparing(false); setReview(null); setConsent(false); onClose(); };
  return <Dialog open={open} onOpenChange={next => { if (!next) close(); }}><DialogContent className="flex max-h-[92dvh] min-w-0 flex-col overflow-hidden sm:max-w-2xl" onEscapeKeyDown={event => { if (locked) event.preventDefault(); }} onInteractOutside={event => { if (locked) event.preventDefault(); }}><DialogHeader><DialogTitle>{titles[selection.action]}</DialogTitle><DialogDescription>Review current details before submitting. The service code is permanent. Existing appointments keep their booked times.</DialogDescription></DialogHeader>
    <div className="min-h-0 flex-1 overflow-y-auto pr-1">{controller.unknown || controller.saved ? <SavedResult {...{ controller, access, onDone, finishing }} /> : <form id="bookable-service-change" onSubmit={prepare} className="grid gap-5">
      {metadata && <><div className="grid gap-2"><Label htmlFor="service-name">Service name</Label><Input id="service-name" value={fields.name} onChange={event => change({ name: event.target.value })} disabled={busy} required autoComplete="off" /><p className="text-xs text-muted-foreground">Up to 160 UTF-8 bytes; no leading or trailing spaces or control characters.</p></div><div className="grid gap-2"><Label htmlFor="service-duration">Default duration (minutes)</Label><Input id="service-duration" type="number" min="1" max="1440" step="1" value={fields.duration} onChange={event => change({ duration: event.target.value })} disabled={busy} required /><p className="text-xs text-muted-foreground">A whole number from 1 to 1440. Changing the default does not move booked appointments.</p></div></>}
      {selection.action === 'create' ? <div className="grid gap-2"><Label htmlFor="service-code">Permanent code</Label><Input id="service-code" value={fields.code} onChange={event => change({ code: event.target.value })} disabled={busy} required maxLength={48} pattern="[A-Za-z0-9_-]+" autoComplete="off" /><p className="text-xs text-muted-foreground">Up to 48 letters, numbers, underscores or hyphens.</p></div> : <p className="break-words text-sm text-muted-foreground">Permanent code: {serviceCode(selection.service)}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}{controller.error && <p role="alert" className="text-sm text-destructive">{controller.error}</p>}
      {review && <><ReviewEvidence review={review} /><label className="flex items-start gap-3 text-sm"><Checkbox checked={consent} onCheckedChange={value => setConsent(value === true)} disabled={busy} aria-label="I reviewed this exact service change" /><span>I reviewed this exact change and its current service version.</span></label></>}
    </form>}</div>
    <DialogFooter className="shrink-0 flex-wrap gap-2 border-t pt-4">{!controller.locked && <Button type="submit" form="bookable-service-change" variant="outline" disabled={busy || !access.canWrite}>{preparing ? 'Confirming current service…' : 'Refresh and review change'}</Button>}{review && !controller.locked && <Button type="button" disabled={busy || !consent || !access.canWrite} onClick={() => controller.run(review)}>Confirm reviewed change</Button>}<Button type="button" variant="outline" disabled={locked} onClick={close}>Close review</Button></DialogFooter>
  </DialogContent></Dialog>;
}
