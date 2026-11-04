import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { assertWriteRecoveryReadCurrent } from '@/lib/api/v2/writeUncertainty';
import { isCurrentReadDenial } from '@/lib/api/v2/readDenials';
import { useScopedNotifications } from '@/shared/hooks/useScopedNotifications';
import { inventorySupplierApi } from '../api';
import { CONTACT_FIELDS, errorCopy, prepareCommand } from '../model';
import { SupplierFields } from './SupplierFields';
import { SupplierResult } from './SupplierResult';
import { SupplierValues } from './SupplierValues';
import { SupplierReview } from './SupplierReview';
const titles = { create: 'Add supplier', correct: 'Correct supplier details', retire: 'Retire supplier', reactivate: 'Reactivate supplier' };
function initialFields(supplier) {
  return { code: supplier?.code ?? '', name: supplier?.name ?? '', reason: '', ...Object.fromEntries(CONTACT_FIELDS.flatMap(field => [[field, supplier?.[field] ?? ''], [`${field}Mode`, supplier?.[field] == null ? 'null' : 'text']])) };
}
export function SupplierChangeDialog({ selection, open, onClose, access, controller, onDenied, onDone, finishing, sourceToken, captureReturnFocus }) {
  const create = selection.action === 'create', correct = selection.action === 'correct', metadata = create || correct;
  const [fields, setFields] = useState(() => initialFields(selection.supplier)), [review, setReview] = useState(null), [consent, setConsent] = useState(false), [error, setError] = useState(null), [preparing, setPreparing] = useState(false);
  const operation = useRef(null), mounted = useRef(false), source = useRef(sourceToken), epoch = useRef(0), returnFocus = useRef(null), capture = useScopedNotifications(access.scope);
  const invalidate = useCallback(() => { epoch.current++; setReview(null); setConsent(false); }, []);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current?.abort(); operation.current = null; }; }, []);
  useLayoutEffect(() => { if (source.current !== sourceToken) { source.current = sourceToken; invalidate(); } }, [sourceToken, invalidate]);
  useLayoutEffect(() => { if (!access.canWrite || (controller.error && !controller.unknown)) invalidate(); }, [access.canWrite, controller.error, controller.unknown, invalidate]);
  const change = patch => { setFields(old => ({ ...old, ...patch })); invalidate(); setError(null); };
  const prepare = async event => {
    event.preventDefault(); if (operation.current || controller.locked || !access.canWrite) return;
    // Snapshot all raw nullable values before any protected read or digest await.
    const lease = capture(), attemptEpoch = epoch.current, abort = new AbortController(), snapshot = structuredClone(fields);
    operation.current = abort; setPreparing(true); setReview(null); setConsent(false); setError(null);
    try {
      if (!lease.isCurrent()) return;
      const own = create ? null : await inventorySupplierApi.get(selection.supplier.id, { signal: abort.signal });
      const previous = own?.value.supplier ?? null;
      if (own) { assertWriteRecoveryReadCurrent(own.response); if (previous.version !== selection.supplier.version) throw new Error('The supplier changed since this form opened. Close, refresh and review its current revision.'); }
      if (!metadata && own.value.eligibility.lifecycle_blocked_by) throw new Error('A retained item reference blocks this active-state action. Refresh current state before another review.');
      const contacts = Object.fromEntries(CONTACT_FIELDS.map(field => { if (!['null', 'text'].includes(snapshot[`${field}Mode`])) throw new Error('Choose whether each contact value is recorded before review.'); return [field, snapshot[`${field}Mode`] === 'null' ? null : snapshot[field]]; }));
      const input = create ? { action: 'create', client_request_id: crypto.randomUUID(), code: snapshot.code, name: snapshot.name, ...contacts }
        : { action: selection.action, client_request_id: crypto.randomUUID(), supplier_id: previous.id, expected_version: previous.version, ...(correct ? { name: snapshot.name, ...contacts, reason: snapshot.reason } : {}) };
      const command = await prepareCommand(input, access.user.id, previous);
      if (own) assertWriteRecoveryReadCurrent(own.response);
      if (!abort.signal.aborted && operation.current === abort && mounted.current && lease.isCurrent()) { if (attemptEpoch === epoch.current) setReview(command); else setError('Supplier source data changed during preparation. Refresh and review the exact change again.'); }
    } catch (failure) {
      if (!abort.signal.aborted && mounted.current && operation.current === abort && attemptEpoch === epoch.current && isCurrentReadDenial(failure)) onDenied();
      else if (!abort.signal.aborted && mounted.current && operation.current === abort && lease.isCurrent()) setError(failure.status ? errorCopy(failure) : failure.message);
    } finally { if (operation.current === abort) { operation.current = null; if (mounted.current) setPreparing(false); } }
  };
  const locked = controller.busy || finishing, busy = preparing || locked;
  const close = () => { if (locked) return; const abort = operation.current; operation.current = null; abort?.abort(); setPreparing(false); invalidate(); onClose(); };
  return <Dialog open={open} onOpenChange={next => { if (!next) close(); }}><DialogContent className="flex max-h-[92dvh] min-w-0 flex-col overflow-hidden sm:max-w-2xl" onOpenAutoFocus={() => { returnFocus.current = captureReturnFocus(); }} onCloseAutoFocus={event => { event.preventDefault(); const restore = returnFocus.current; returnFocus.current = null; restore?.(); }} onEscapeKeyDown={event => { if (locked) event.preventDefault(); }} onInteractOutside={event => { if (locked) event.preventDefault(); }}><DialogHeader><DialogTitle>{titles[selection.action]}</DialogTitle><DialogDescription>Review the current supplier and exact proposed values. Supplier identity and code remain permanent.</DialogDescription></DialogHeader>
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto pr-1">{controller.unknown || controller.saved ? <SupplierResult {...{ controller, access, onDone, finishing }} /> : <form id="inventory-supplier-change" noValidate className="grid min-w-0 gap-5" onSubmit={prepare}>{metadata ? <SupplierFields {...{ create, selection, busy, fields, change }} /> : <SupplierValues value={selection.supplier} />}{error && <p role="alert" className="text-sm text-destructive">{error}</p>}{controller.error && <p role="alert">{controller.error}</p>}{review && <><SupplierReview command={review} /><label className="flex items-start gap-3 text-sm"><Checkbox checked={consent} onCheckedChange={value => setConsent(value === true)} disabled={busy} aria-label="I reviewed this exact supplier change" /><span>I reviewed these exact values, the current revision and workflow consequences.</span></label></>}</form>}</div>
    <DialogFooter className="shrink-0 flex-wrap gap-2 border-t pt-4">{!controller.locked && <Button className="h-auto min-h-9 whitespace-normal" type="submit" form="inventory-supplier-change" variant="outline" disabled={busy || !access.canWrite}>{preparing ? 'Confirming current supplier…' : 'Refresh and review supplier change'}</Button>}{review && !controller.locked && <Button className="h-auto min-h-9 whitespace-normal" type="button" disabled={busy || !consent || !access.canWrite} onClick={() => controller.run(review)}>Confirm reviewed supplier change</Button>}<Button className="h-auto min-h-9 whitespace-normal" type="button" variant="outline" disabled={locked} onClick={close}>Close supplier review</Button></DialogFooter>
  </DialogContent></Dialog>;
}
