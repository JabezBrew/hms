import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { assertWriteRecoveryReadCurrent } from '@/lib/api/v2/writeUncertainty';
import { isCurrentReadDenial } from '@/lib/api/v2/readDenials';
import { useScopedNotifications } from '@/shared/hooks/useScopedNotifications';
import { laboratoryCatalogApi } from '../api';
import { errorCopy, prepareCommand } from '../model';
import { CatalogValues } from './CatalogDetail';
import { CatalogResult } from './CatalogResult';
export function CatalogChangeDialog({ selection, open, onClose, access, controller, onDenied, onDone, finishing, sourceToken, captureReturnFocus }) {
  const [fields, setFields] = useState(() => ({ is_active: !selection.definition.is_active, reason: '' })), [review, setReview] = useState(null), [consent, setConsent] = useState(false), [error, setError] = useState(null), [preparing, setPreparing] = useState(false);
  const operation = useRef(null), mounted = useRef(false), source = useRef(sourceToken), epoch = useRef(0), returnFocus = useRef(null), capture = useScopedNotifications(access.scope);
  const invalidate = useCallback(() => { epoch.current++; setReview(null); setConsent(false); }, []);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current?.abort(); operation.current = null; }; }, []);
  useLayoutEffect(() => { if (source.current !== sourceToken) { source.current = sourceToken; invalidate(); } }, [sourceToken, invalidate]);
  useLayoutEffect(() => { if (!access.canWrite || (controller.error && !controller.unknown)) invalidate(); }, [access.canWrite, controller.error, controller.unknown, invalidate]);
  const change = patch => { setFields(old => ({ ...old, ...patch })); invalidate(); setError(null); };
  const prepare = async event => {
    event.preventDefault(); if (operation.current || controller.locked || !access.canWrite) return;
    const lease = capture(), attemptEpoch = epoch.current, abort = new AbortController(), snapshot = structuredClone(fields);
    operation.current = abort; setPreparing(true); setReview(null); setConsent(false); setError(null);
    try {
      if (!lease.isCurrent()) return;
      const own = await laboratoryCatalogApi.get(selection.kind, selection.definition.id, { signal: abort.signal });
      assertWriteRecoveryReadCurrent(own.response);
      if (own.value.definition.version !== selection.definition.version) throw new Error('The definition changed since this review opened. Close, refresh and review its current revision.');
      const command = await prepareCommand({ action: 'set_availability', subject_kind: selection.kind, subject_id: selection.definition.id, client_request_id: crypto.randomUUID(), expected_version: own.value.definition.version, is_active: snapshot.is_active, reason: snapshot.reason }, access.user.id, own.value);
      assertWriteRecoveryReadCurrent(own.response);
      if (!abort.signal.aborted && operation.current === abort && mounted.current && lease.isCurrent()) {
        if (attemptEpoch === epoch.current) setReview({ command, rawReason: snapshot.reason });
        else setError('The source changed during preparation. Refresh and review again.');
      }
    } catch (failure) {
      if (!abort.signal.aborted && mounted.current && operation.current === abort && isCurrentReadDenial(failure)) onDenied();
      else if (!abort.signal.aborted && mounted.current && operation.current === abort && lease.isCurrent()) setError(failure.status ? errorCopy(failure) : failure.message);
    } finally { if (operation.current === abort) { operation.current = null; if (mounted.current) setPreparing(false); } }
  };
  const locked = controller.busy || finishing, busy = preparing || locked;
  const close = () => { if (locked) return; const abort = operation.current; operation.current = null; abort?.abort(); setPreparing(false); invalidate(); onClose(); };
  return <Dialog open={open} onOpenChange={next => { if (!next) close(); }}><DialogContent className="flex max-h-[92dvh] min-w-0 flex-col overflow-hidden sm:max-w-2xl" onOpenAutoFocus={() => { returnFocus.current = captureReturnFocus(); }} onCloseAutoFocus={event => { event.preventDefault(); const restore = returnFocus.current; returnFocus.current = null; restore?.(); }} onEscapeKeyDown={event => { if (locked) event.preventDefault(); }} onInteractOutside={event => { if (locked) event.preventDefault(); }}><DialogHeader><DialogTitle>Review {selection.kind} availability</DialogTitle><DialogDescription>Change future ordering availability while preserving accepted orders and results.</DialogDescription></DialogHeader><div className="min-h-0 min-w-0 flex-1 overflow-y-auto pr-1">{controller.unknown || controller.saved ? <CatalogResult {...{ controller, access, onDone, finishing }} /> : <form id="laboratory-availability-change" noValidate onSubmit={prepare} className="grid min-w-0 gap-5"><CatalogValues subject={selection} /><div className="grid gap-1.5"><Label htmlFor="lab-availability">Requested availability</Label><select id="lab-availability" className="h-10 rounded-md border bg-background px-3 text-sm" disabled={busy} value={String(fields.is_active)} onChange={event => change({ is_active: event.target.value === 'true' })}><option value="true">Active</option><option value="false">Inactive</option></select></div><div className="grid gap-1.5"><Label htmlFor="lab-availability-reason">Reason</Label><Textarea id="lab-availability-reason" rows={3} disabled={busy} value={fields.reason} onChange={event => change({ reason: event.target.value })} /></div>{error && <p role="alert">{error}</p>}{controller.error && <p role="alert">{controller.error}</p>}{review && <section aria-label="Exact availability review" className="grid min-w-0 gap-3 rounded-xl border p-4"><CatalogValues subject={review.command.previous} /><p>{review.command.previous.definition.is_active ? 'Active' : 'Inactive'} → <strong>{review.command.input.is_active ? 'Active' : 'Inactive'}</strong></p>{review.command.previous.definition.is_active === review.command.input.is_active && <p>This records the request without changing availability, revision or attribution.</p>}<p className="text-sm">Recorded reason (escaped exact text)</p><pre className="whitespace-pre-wrap break-all rounded border bg-muted/20 p-3 text-sm">{JSON.stringify(review.command.input.reason)}</pre>{review.rawReason !== review.command.input.reason && <details><summary className="text-sm">Entered text before surrounding whitespace was removed</summary><pre className="whitespace-pre-wrap break-all p-2 text-sm">{JSON.stringify(review.rawReason)}</pre></details>}<p className="text-sm">Active panels still require every configured test to be available. Ordering observations are checked again by the server.</p><label className="flex items-start gap-3 text-sm"><Checkbox aria-label="I reviewed this exact availability change" checked={consent} disabled={busy} onCheckedChange={value => setConsent(value === true)} /><span>I reviewed this definition, revision, reason and effect on future orders.</span></label></section>}</form>}</div><DialogFooter className="shrink-0 flex-wrap gap-2 border-t pt-4">{!controller.locked && <Button type="submit" form="laboratory-availability-change" variant="outline" disabled={busy || !access.canWrite} className="h-auto min-h-9 whitespace-normal">{preparing ? 'Confirming current definition…' : 'Refresh and review availability'}</Button>}{review && !controller.locked && <Button type="button" disabled={busy || !consent || !access.canWrite} onClick={() => controller.run(review.command)} className="h-auto min-h-9 whitespace-normal">Confirm reviewed availability</Button>}<Button type="button" variant="outline" disabled={locked} onClick={close}>Close availability review</Button></DialogFooter></DialogContent></Dialog>;
}
