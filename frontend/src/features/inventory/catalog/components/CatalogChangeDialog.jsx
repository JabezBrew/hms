import { useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { isCurrentReadDenial } from '@/lib/api/v2/readDenials';
import { useScopedNotifications } from '@/shared/hooks/useScopedNotifications';
import { inventoryCatalogApi } from '../api';
import { displayText, errorCopy, prepareCommand, utcToday } from '../model';
import { confirmCategory } from '../categorySelection';
import { CatalogFields } from './CatalogFields';
import { CatalogResult } from './CatalogResult';
const titles = { create: 'Add catalog item', correct: 'Record dated catalog correction', retire: 'Deactivate catalog item', reactivate: 'Reactivate catalog item' };
function ExactReview({ command }) {
 const { input, previous } = command;
 return <div className="grid gap-3 rounded-xl border bg-muted/30 p-4"><h3 className="font-medium">Review exact catalog change</h3>{previous && <p className="break-words">Current: {displayText(previous.name)} ({displayText(previous.code)}) · Unit: {displayText(previous.unit)} · Revision {previous.version} · {previous.is_active ? 'Active' : 'Inactive'}</p>}
 {['create', 'correct'].includes(input.action) ? <><dl className="grid gap-2 text-sm">{['code', 'name', 'unit'].map(key => <div key={key} className="grid gap-1 sm:grid-cols-[5rem_minmax(0,1fr)]"><dt className="capitalize text-muted-foreground">{key}</dt><dd className="whitespace-pre-wrap break-words">{displayText(input[key])}{previous && input[key] === previous[key] && <span className="ml-2 text-xs text-muted-foreground">Unchanged raw value</span>}</dd></div>)}</dl>{input.action === 'correct' ? <p className="text-sm">Reviewed date: {input.effective_from}. Reason: {input.reason}. Recording applies current metadata now; it does not replay or schedule stock, pricing, orders or care.</p> : <p className="text-sm">Create an ordinary {input.item_type} item in the explicitly selected category. This creates no stock, price or supplier.</p>}</> : <p className="text-sm">{input.action === 'retire' ? 'Stop new item selection. Any retained operational reference, including completed or zero-stock records, can prevent deactivation.' : 'Allow new selection again if the server confirms ordinary classification and no retained operational references.'} Existing recorded work stays intact.</p>}</div>;
}
export function CatalogChangeDialog({ selection, open, onClose, access, controller, onDenied, onDone, finishing, sourceToken }) {
 const create = selection.action === 'create', correct = selection.action === 'correct', metadata = create || correct;
 const [fields, setFields] = useState({ code: selection.item?.code ?? '', name: selection.item?.name ?? '', unit: selection.item?.unit ?? '', item_type: '', effective_from: utcToday(), reason: '' });
 const [category, setCategory] = useState(null), [review, setReview] = useState(null), [consent, setConsent] = useState(false), [error, setError] = useState(null), [preparing, setPreparing] = useState(false);
 const operation = useRef(null), mounted = useRef(false), source = useRef(sourceToken), epoch = useRef(0), capture = useScopedNotifications(access.scope);
 useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current?.abort(); operation.current = null; }; }, []);
 useLayoutEffect(() => { if (source.current !== sourceToken) { source.current = sourceToken; epoch.current++; setReview(null); setConsent(false); } }, [sourceToken]);
 useLayoutEffect(() => { if (!access.canWrite || (controller.error && !controller.unknown)) { setReview(null); setConsent(false); } }, [access.canWrite, controller.error, controller.unknown]);
 const change = patch => { setFields(old => ({ ...old, ...patch })); setReview(null); setConsent(false); setError(null); };
 const prepare = async event => {
  event.preventDefault(); if (operation.current || controller.locked || !access.canWrite) return;
  const lease = capture(), attemptEpoch = epoch.current, abort = new AbortController(), snapshot = structuredClone(fields), chosen = category; operation.current = abort; setPreparing(true); setReview(null); setConsent(false); setError(null);
  try {
   if (!lease.isCurrent()) return;
   const detail = create ? null : (await inventoryCatalogApi.get(selection.item.id, { signal: abort.signal })).value;
   const previous = detail?.item ?? null;
   if (!create && selection.action !== 'correct' && detail.eligibility.lifecycle_blocked_by) throw new Error('This active-state action is blocked by the current classification or retained operational references. Refresh current state before reviewing another action.');
   if (correct && snapshot.unit !== previous.unit && detail.eligibility.unit_change_blocked_by) throw new Error('This stock unit cannot change while the current classification or retained operational references block it. An unchanged-unit metadata correction remains separate.');
   const input = create ? { action: 'create', client_request_id: crypto.randomUUID(), category_id: confirmCategory(chosen).id, code: snapshot.code, name: snapshot.name, unit: snapshot.unit, item_type: snapshot.item_type }
    : { action: selection.action, client_request_id: crypto.randomUUID(), item_id: previous.id, expected_version: previous.version, ...(correct ? { code: snapshot.code, name: snapshot.name, unit: snapshot.unit, effective_from: snapshot.effective_from, reason: snapshot.reason } : {}) };
   const command = await prepareCommand(input, access.user.id, previous);
   if (!abort.signal.aborted && operation.current === abort && mounted.current && lease.isCurrent()) { if (attemptEpoch === epoch.current) setReview(command); else setError('Catalog source data changed during preparation. Refresh and review the exact change again.'); }
  } catch (failure) {
   if (!abort.signal.aborted && mounted.current && operation.current === abort && attemptEpoch === epoch.current && isCurrentReadDenial(failure)) onDenied();
   else if (!abort.signal.aborted && mounted.current && operation.current === abort && lease.isCurrent()) setError(failure.status ? errorCopy(failure) : failure.message);
  } finally { if (operation.current === abort) { operation.current = null; if (mounted.current) setPreparing(false); } }
 };
 const locked = controller.busy || finishing, busy = preparing || locked;
 const close = () => { if (locked) return; const abort = operation.current; operation.current = null; abort?.abort(); setPreparing(false); setReview(null); setConsent(false); onClose(); };
 return <Dialog open={open} onOpenChange={next => { if (!next) close(); }}><DialogContent className="flex max-h-[92dvh] min-w-0 flex-col overflow-hidden sm:max-w-2xl" onEscapeKeyDown={event => { if (locked) event.preventDefault(); }} onInteractOutside={event => { if (locked) event.preventDefault(); }}><DialogHeader><DialogTitle>{titles[selection.action]}</DialogTitle><DialogDescription>Review the current exact item revision before submitting. Stock, supplier, pricing and care records keep their recorded meaning.</DialogDescription></DialogHeader>
 <div className="min-h-0 flex-1 overflow-y-auto pr-1">{controller.unknown || controller.saved ? <CatalogResult {...{ controller, access, onDone, finishing }} /> : <form id="inventory-catalog-change" className="grid min-w-0 gap-5" onSubmit={prepare}>
 <CatalogFields {...{ create, correct, selection, access, busy, fields, change, category, onDenied }} chooseCategory={value => { setCategory(value); setReview(null); setConsent(false); }} />
 {!metadata && <p className="break-words text-sm">{displayText(selection.item.name)} ({displayText(selection.item.code)}) · Unit: {displayText(selection.item.unit)} · Revision {selection.item.version}</p>}
 {error && <p role="alert" className="text-sm text-destructive">{error}</p>}{controller.error && <p role="alert">{controller.error}</p>}{review && <><ExactReview command={review} /><label className="flex items-start gap-3 text-sm"><Checkbox checked={consent} onCheckedChange={value => setConsent(value === true)} disabled={busy} aria-label="I reviewed this exact catalog change" /><span>I reviewed this exact input, its current revision and its workflow consequences.</span></label></>}
 </form>}</div><DialogFooter className="shrink-0 flex-wrap gap-2 border-t pt-4">{!controller.locked && <Button type="submit" form="inventory-catalog-change" variant="outline" disabled={busy || !access.canWrite}>{preparing ? 'Confirming current catalog…' : 'Refresh and review catalog change'}</Button>}{review && !controller.locked && <Button type="button" disabled={busy || !consent || !access.canWrite} onClick={() => controller.run(review)}>Confirm reviewed catalog change</Button>}<Button type="button" variant="outline" disabled={locked} onClick={close}>Close catalog review</Button></DialogFooter>
 </DialogContent></Dialog>;
}
