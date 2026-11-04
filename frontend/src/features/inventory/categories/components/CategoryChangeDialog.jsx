import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { assertWriteRecoveryReadCurrent } from '@/lib/api/v2/writeUncertainty';
import { isCurrentReadDenial } from '@/lib/api/v2/readDenials';
import { useScopedNotifications } from '@/shared/hooks/useScopedNotifications';
import { inventoryCategoryApi } from '../api';
import { errorCopy, prepareCommand } from '../model';
import { confirmParent, confirmParentDetail } from '../parentSelection';
import { CategoryFields } from './CategoryFields';
import { CategoryResult } from './CategoryResult';
import { CategoryValues, RawValue } from './CategoryValues';
const titles = { create: 'Add category', correct: 'Correct category details', retire: 'Retire category', reactivate: 'Reactivate category' };
function ExactReview({ command }) {
  const { input, previous } = command;
  const parent = input.action === 'create' ? input.parent : input.parent_change;
  return <div className="grid min-w-0 gap-3 rounded-xl border bg-muted/30 p-4"><h3 className="font-medium">Review exact category change</h3>{previous && <section className="grid min-w-0 gap-2"><h4 className="font-medium">Current reviewed category</h4><p className="whitespace-pre-wrap font-mono [overflow-wrap:anywhere]">{previous.code} · {previous.is_active ? 'Active' : 'Retired'}</p><CategoryValues value={previous} /></section>}
    {['create', 'correct'].includes(input.action) ? <><dl className="grid min-w-0 grid-cols-1 gap-3 text-sm">{input.action === 'create' && <div className="min-w-0"><dt className="text-muted-foreground">Permanent code</dt><dd><RawValue value={input.code} /></dd></div>}<div className="min-w-0"><dt className="text-muted-foreground">Reviewed name</dt><dd><RawValue value={input.name} />{previous && input.name === previous.name && <span className="ml-2 text-xs text-muted-foreground">Unchanged raw value</span>}</dd></div><div className="min-w-0"><dt className="text-muted-foreground">Reviewed description</dt><dd><RawValue value={input.description} />{previous && input.description === previous.description && <span className="ml-2 text-xs text-muted-foreground">Unchanged raw value</span>}</dd></div><div className="min-w-0"><dt className="text-muted-foreground">Reviewed parent relationship</dt><dd className="[overflow-wrap:anywhere]">{parent === null || parent?.action === 'clear' ? 'No direct parent' : parent?.action === 'retain' ? 'Keep exact recorded parent pointer' : <><span className="font-mono">{parent.parent_id}</span> · Revision {parent.expected_parent_version}</>}</dd></div>{input.action === 'correct' && <div className="min-w-0"><dt className="text-muted-foreground">Correction reason</dt><dd><RawValue value={input.reason} /></dd></div>}</dl><p className="text-sm">Current category and item displays use the corrected name. General item search may retain an older local category label until an explicit operator rebuild.</p></> : <p className="text-sm">{input.action === 'retire' ? 'Stop new category selection.' : 'Allow new category selection again.'} Any retained item or current child pointer blocks this unused-only action, including inactive or malformed references. Pure historical observations alone are not current membership.</p>}
  </div>;
}
export function CategoryChangeDialog({ selection, open, onClose, access, controller, onDenied, onDone, finishing, sourceToken, captureReturnFocus }) {
  const create = selection.action === 'create', correct = selection.action === 'correct', metadata = create || correct;
  const [fields, setFields] = useState({ code: selection.category?.code ?? '', name: selection.category?.name ?? '', description: selection.category?.description ?? '', descriptionMode: selection.category?.description === null || create ? 'null' : 'text', parentMode: create ? '' : 'retain', reason: '' });
  const [parent, setParent] = useState(null), [review, setReview] = useState(null), [consent, setConsent] = useState(false), [error, setError] = useState(null), [preparing, setPreparing] = useState(false);
  const operation = useRef(null), mounted = useRef(false), source = useRef(sourceToken), epoch = useRef(0), returnFocus = useRef(null), capture = useScopedNotifications(access.scope);
  const invalidate = useCallback(() => { epoch.current++; setReview(null); setConsent(false); }, []);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current?.abort(); operation.current = null; }; }, []);
  useLayoutEffect(() => { if (source.current !== sourceToken) { source.current = sourceToken; invalidate(); } }, [sourceToken, invalidate]);
  useLayoutEffect(() => { if (!access.canWrite || (controller.error && !controller.unknown)) invalidate(); }, [access.canWrite, controller.error, controller.unknown, invalidate]);
  const change = patch => { setFields(old => ({ ...old, ...patch })); invalidate(); setError(null); };
  const prepare = async event => {
    event.preventDefault(); if (operation.current || controller.locked || !access.canWrite) return;
    // Capture text and original protected observations before any source read or hashing.
    const lease = capture(), attemptEpoch = epoch.current, abort = new AbortController(), snapshot = structuredClone(fields), chosen = parent;
    operation.current = abort; setPreparing(true); setReview(null); setConsent(false); setError(null);
    try {
      if (!lease.isCurrent()) return;
      if (metadata && !['retain', 'clear', 'set'].includes(snapshot.parentMode)) throw new Error('Explicitly choose no direct parent or an exact parent before review.');
      if (snapshot.parentMode === 'set') confirmParent(chosen);
      const [own, parentResult] = await Promise.all([
        create ? null : inventoryCategoryApi.get(selection.category.id, { signal: abort.signal }),
        metadata && snapshot.parentMode === 'set' ? inventoryCategoryApi.get(chosen.row.id, { signal: abort.signal }) : null,
      ]);
      const previous = own?.value.category ?? null;
      if (own) { assertWriteRecoveryReadCurrent(own.response); if (previous.version !== selection.category.version) throw new Error('The category changed since this form opened. Close, refresh and review its current revision.'); }
      if (!metadata && own.value.eligibility.lifecycle_blocked_by) throw new Error('A retained item or current child reference blocks this active-state action. Refresh current state before another review.');
      const selectedParent = parentResult ? confirmParentDetail(chosen, parentResult) : null;
      const parentChange = snapshot.parentMode === 'set' ? { action: 'set', ...selectedParent } : { action: snapshot.parentMode };
      const description = snapshot.descriptionMode === 'null' ? null : snapshot.description;
      const input = create ? { action: 'create', client_request_id: crypto.randomUUID(), code: snapshot.code, name: snapshot.name, description, parent: selectedParent }
        : { action: selection.action, client_request_id: crypto.randomUUID(), category_id: previous.id, expected_version: previous.version, ...(correct ? { name: snapshot.name, description, parent_change: parentChange, reason: snapshot.reason } : {}) };
      const command = await prepareCommand(input, access.user.id, previous);
      if (own) assertWriteRecoveryReadCurrent(own.response);
      if (parentResult) confirmParentDetail(chosen, parentResult);
      if (!abort.signal.aborted && operation.current === abort && mounted.current && lease.isCurrent()) { if (attemptEpoch === epoch.current) setReview(command); else setError('Category source data changed during preparation. Refresh and review the exact change again.'); }
    } catch (failure) {
      if (!abort.signal.aborted && mounted.current && operation.current === abort && isCurrentReadDenial(failure)) onDenied();
      else if (!abort.signal.aborted && mounted.current && operation.current === abort && lease.isCurrent()) setError(failure.status ? errorCopy(failure) : failure.message);
    } finally { if (operation.current === abort) { operation.current = null; if (mounted.current) setPreparing(false); } }
  };
  const locked = controller.busy || finishing, busy = preparing || locked;
  const close = () => { if (locked) return; const abort = operation.current; operation.current = null; abort?.abort(); setPreparing(false); invalidate(); onClose(); };
  return <Dialog open={open} onOpenChange={next => { if (!next) close(); }}><DialogContent className="flex max-h-[92dvh] min-w-0 flex-col overflow-hidden sm:max-w-2xl" onOpenAutoFocus={() => { returnFocus.current = captureReturnFocus(); }} onCloseAutoFocus={event => { event.preventDefault(); const restore = returnFocus.current; returnFocus.current = null; restore?.(); }} onEscapeKeyDown={event => { if (locked) event.preventDefault(); }} onInteractOutside={event => { if (locked) event.preventDefault(); }}><DialogHeader><DialogTitle>{titles[selection.action]}</DialogTitle><DialogDescription>Review exact current revisions and direct grouping. Category identity and code remain permanent.</DialogDescription></DialogHeader>
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto pr-1">{controller.unknown || controller.saved ? <CategoryResult {...{ controller, access, onDone, finishing }} /> : <form id="inventory-category-change" className="grid min-w-0 gap-5" onSubmit={prepare}>{metadata ? <CategoryFields {...{ create, selection, access, busy, fields, change, parent, onDenied }} chooseParent={value => { setParent(value); invalidate(); }} onParentSourceChange={invalidate} /> : <CategoryValues value={selection.category} />}{error && <p role="alert" className="text-sm text-destructive">{error}</p>}{controller.error && <p role="alert">{controller.error}</p>}{review && <><ExactReview command={review} /><label className="flex items-start gap-3 text-sm"><Checkbox checked={consent} onCheckedChange={value => setConsent(value === true)} disabled={busy} aria-label="I reviewed this exact category change" /><span>I reviewed this exact input, current revisions and workflow consequences.</span></label></>}</form>}</div>
    <DialogFooter className="shrink-0 flex-wrap gap-2 border-t pt-4">{!controller.locked && <Button className="h-auto min-h-9 whitespace-normal" type="submit" form="inventory-category-change" variant="outline" disabled={busy || !access.canWrite}>{preparing ? 'Confirming current category…' : 'Refresh and review category change'}</Button>}{review && !controller.locked && <Button className="h-auto min-h-9 whitespace-normal" type="button" disabled={busy || !consent || !access.canWrite} onClick={() => controller.run(review)}>Confirm reviewed category change</Button>}<Button type="button" variant="outline" disabled={locked} onClick={close}>Close category review</Button></DialogFooter>
  </DialogContent></Dialog>;
}
