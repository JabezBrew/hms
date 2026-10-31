import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { useReadOnlyMode } from '@/contexts/ReadOnlyModeContext';
import { getV2ClientScopeKey, subscribeV2ClientScope, v2Api } from '@/lib/api/v2/client';
import { currentNetworkPrincipal, networkClockCurrent } from '@/lib/api/v2/networkAccessGuard';
import { getWriteUncertaintySnapshot, subscribeWriteUncertainty } from '@/lib/api/v2/writeUncertainty';
import { authorizationScope } from '@/shared/lib/authorizationScope';
import { hashQueryValue } from '@/shared/lib/privateQueryKey';
import { useScopedNotifications } from '@/shared/hooks/useScopedNotifications';
import { useCommandTransportLifetime } from '@/shared/hooks/useCommandTransportLifetime';
import { userHasCapability } from '@/shared/lib/access';
import { useCreateTransferRequest } from '@/hooks/useInventoryQueries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { canReadCatalog } from '../catalog/access';
import { prepareTransferReview, selectedItem } from './model';
import { TransferSourcePicker } from './TransferSourcePicker';

export function RustTransferRequestForm(props) {
  const { user } = useAuth();
  const network = useReadOnlyMode({ optional: true });
  const transport = useSyncExternalStore(subscribeV2ClientScope, getV2ClientScopeKey, getV2ClientScopeKey);
  const scope = hashQueryValue(JSON.stringify([authorizationScope(user, transport), network?.networkDecision?.policy_version]));
  const canRead = canReadCatalog(user) && network?.networkConfirmed === true && network.canRead === true;
  const canWrite = canRead && userHasCapability(user, 'inventory.manage') && network.isReadOnly === false;
  return canRead ? <TransferDraft key={scope} {...props} scope={scope} userId={user.id} canWrite={canWrite} decision={network.networkDecision} /> : <Alert><AlertDescription>Current inventory read access is unavailable. Protected transfer choices are hidden.</AlertDescription></Alert>;
}

function TransferDraft({ scope, userId, canWrite, decision, initialToLocation, onSuccess, onCancel, onBusyChange }) {
  const [item, setItem] = useState(null), [from, setFrom] = useState(null), [to, setTo] = useState(null);
  const [unavailable, setUnavailable] = useState(false);
  const selectionSerial = useRef(0);
  const dropSources = useCallback(() => { setItem(null); setFrom(null); setTo(null); setUnavailable(true); }, []);
  const chooseItem = row => { setItem({ ...selectedItem(row), selectionSerial: ++selectionSerial.current }); setUnavailable(false); };
  const chooseFrom = row => { setFrom(row); setUnavailable(false); };
  const chooseTo = row => { setTo(row); setUnavailable(false); };
  // An initial destination is only a hint; it never grants active eligibility.
  return <div className="flex flex-col gap-6">
    <p className="text-sm text-muted-foreground">Request one item in its current recorded unit. This creates a request; it does not move stock.</p>
    {initialToLocation && !to && <p className="text-sm">Select the destination explicitly from current active locations.</p>}
    {!canWrite && <Alert><AlertDescription>Transfer requests require inventory management authority and current writable network access.</AlertDescription></Alert>}
    {unavailable && <p role="alert">A current source read failed. Select the item and locations again.</p>}
    <TransferEditorSources {...{ scope, item, from, to, canWrite, chooseItem, chooseFrom, chooseTo, dropSources, userId, decision, onSuccess, onCancel, onBusyChange }} />
  </div>;
}

function TransferEditorSources({ scope, item, from, to, canWrite, chooseItem, chooseFrom, chooseTo, dropSources, userId, decision, onSuccess, onCancel, onBusyChange }) {
  const [locked, setLocked] = useState(false);
  return <>
    <TransferSourcePicker kind="items" label="Item" scope={scope} selectedId={item?.id} onSelect={chooseItem} disabled={locked} onUnavailable={dropSources} />
    <TransferSourcePicker kind="locations" label="Source location" scope={scope} selectedId={from?.id} onSelect={chooseFrom} disabled={locked} onUnavailable={dropSources} />
    <TransferSourcePicker kind="locations" label="Destination location" scope={scope} selectedId={to?.id} onSelect={chooseTo} disabled={locked} onUnavailable={dropSources} />
    {item ? <TransferSubmission key={`${item.id}:${item.selectionSerial}`} {...{ scope, item, from, to, canWrite, userId, decision, onSuccess, onCancel, onBusyChange, dropSources }} onLockChange={setLocked} /> : <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>}
  </>;
}

function TransferSubmission({ scope, item, from, to, canWrite, userId, decision, onSuccess, onCancel, onBusyChange, dropSources, onLockChange }) {
  const [quantity, setQuantity] = useState(''), [reviewed, setReviewed] = useState(false), [state, setState] = useState({ phase: 'idle', error: null });
  const operation = useRef(null), live = useRef(null);
  const capture = useScopedNotifications(scope), mutation = useCreateTransferRequest();
  const barrier = useSyncExternalStore(subscribeWriteUncertainty, getWriteUncertaintySnapshot, getWriteUncertaintySnapshot);
  const blocked = barrier.unavailable || barrier.entries.length > 0;
  const source = useQuery({ queryKey: ['inventory', 'transfer-source', scope, item.id], queryFn: async ({ signal }) => {
    const response = await v2Api.getInventoryItemById({ id: item.id }, { signal });
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    return selectedItem(response?.data, item.id);
  }, retry: false, staleTime: 0, gcTime: 0 });
  const selected = source.isError || source.isFetching ? null : source.data;
  const pending = state.phase === 'pending', preparing = state.phase === 'preparing';
  const locked = pending || state.phase === 'unknown' || state.phase === 'saved';
  const authorityCurrent = () => Boolean(live.current?.canWrite && networkClockCurrent(live.current?.decision) && currentNetworkPrincipal()?.id === userId);
  useLayoutEffect(() => { live.current = { canWrite, decision }; });
  useLayoutEffect(() => { onBusyChange?.(pending); onLockChange(locked); return () => { onBusyChange?.(false); onLockChange(false); }; }, [pending, locked, onBusyChange, onLockChange]);
  useLayoutEffect(() => { if (source.isError) dropSources(); }, [source.isError, dropSources]);
  useLayoutEffect(() => { setReviewed(false); setQuantity(''); }, [selected]);
  useLayoutEffect(() => {
    setReviewed(false);
    // Unsent checks may cancel safely; changed locations revoke their intent.
    if (operation.current && !pending) { operation.current.abort(); operation.current = null; setState({ phase: 'idle', error: null }); }
  }, [from?.id, to?.id, selected, pending]);
  const interrupted = useCommandTransportLifetime(operation, () => setState({ phase: 'unknown', error: 'Sign-in proof changed while this request was pending. Review saved transfer requests before submitting another.' }));
  useLayoutEffect(() => {
    if (!canWrite && operation.current) {
      operation.current.abort(); operation.current = null;
      setState({ phase: pending ? 'unknown' : 'idle', error: pending ? 'Write access changed while the request was pending. Review saved transfer requests before submitting another.' : null });
    }
  }, [canWrite, pending]);
  useLayoutEffect(() => () => { operation.current?.abort(); live.current = null; }, []);
  const cancel = () => { if (pending) return; operation.current?.abort(); operation.current = null; onCancel?.(); };
  const submit = async event => {
    event.preventDefault();
    if (operation.current || locked || blocked || !authorityCurrent() || !reviewed || !selected) return;
    let review;
    try { review = prepareTransferReview({ item_id: selected.id, from_location_id: from?.id, to_location_id: to?.id, quantity }, selected, selected); }
    catch (error) { setState({ phase: 'idle', error: error.message }); return; }
    // Capture exact user-reviewed unit before any await. The adapter cannot
    // silently fetch a different basis or infer a conversion for this quantity.
    const lease = capture(), controller = new AbortController();
    if (!lease.isCurrent()) return;
    operation.current = controller; setState({ phase: 'preparing', error: null });
    let dispatched = false;
    try {
      const current = await v2Api.getInventoryItemById({ id: selected.id }, { signal: controller.signal });
      if (controller.signal.aborted || !lease.isCurrent() || !authorityCurrent()) { if (live.current) setState({ phase: 'idle', error: null }); return; }
      prepareTransferReview({ item_id: selected.id, from_location_id: review.payload.from_location_id, to_location_id: review.payload.to_location_id, quantity: review.payload.quantity }, review.item, current?.data);
      dispatched = true; setState({ phase: 'pending', error: null }); onBusyChange?.(true);
      await mutation.mutateAsync({ ...review.payload, signal: controller.signal });
      if (controller.signal.aborted || !lease.isCurrent() || !authorityCurrent()) { if (live.current) setState({ phase: 'unknown', error: 'Current access changed before this result could be confirmed. Review saved transfer requests before submitting another.' }); return; }
      setState({ phase: 'saved', error: null }); lease.success('Transfer request created successfully'); onSuccess?.();
    } catch (error) {
      if (controller.signal.aborted || interrupted(controller) || !lease.isCurrent()) { if (live.current) setState({ phase: dispatched ? 'unknown' : 'idle', error: dispatched ? 'Current access changed before this result could be confirmed. Review saved transfer requests before submitting another.' : null }); return; }
      if (!dispatched) { dropSources(); return; }
      const code = String(error.data?.error?.code || '');
      const unknown = !error.status || error.status >= 500 || code.endsWith('_unconfirmed') || code.startsWith('write_review_');
      setState({ phase: unknown ? 'unknown' : 'idle', error: unknown ? 'This request may already be recorded. Review saved transfer requests and the existing recovery notice before submitting another. Automatic retry is unavailable.' : error.message });
      if (!unknown) { setReviewed(false); if (error.status === 403 || code.includes('source') || code.includes('unit')) dropSources(); }
    } finally { if (operation.current === controller) { operation.current = null; onBusyChange?.(false); } }
  };
  return <form onSubmit={submit} className="flex flex-col gap-4">
    {selected ? <div className="min-w-0 rounded-lg border p-4"><p className="font-medium break-words">Selected item: {selected.name} ({selected.code})</p><p className="mt-2 text-sm font-medium">Exact current unit</p><pre id="transfer-raw-unit" aria-label="Exact current unit" className="mt-2 whitespace-pre-wrap break-all font-mono text-sm">{JSON.stringify(selected.unit)}</pre>{selected.unit === '' && <p className="text-sm text-muted-foreground">The recorded unit is blank.</p>}</div> : <p role="status">Loading the current selected item…</p>}
    <Label htmlFor="transfer-quantity">Whole quantity</Label><Input id="transfer-quantity" inputMode="numeric" value={quantity} disabled={locked || preparing || !selected} onChange={event => { setQuantity(event.target.value); setReviewed(false); }} />
    <label className="flex items-start gap-2"><input type="checkbox" checked={reviewed} disabled={locked || preparing || !selected} onChange={event => setReviewed(event.target.checked)} />I reviewed this exact item, raw unit, quantity and locations.</label>
    {from && to && <p className="text-sm break-words">{from.name} → {to.name}</p>}
    {(state.error || blocked) && <Alert><AlertDescription>{state.error || 'A previous change needs review before a new transfer request.'}</AlertDescription></Alert>}
    <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" onClick={cancel} disabled={pending}>Cancel</Button><Button type="submit" disabled={locked || preparing || blocked || !canWrite || !reviewed || !selected || !from || !to}>{pending ? 'Requesting…' : preparing ? 'Checking current source…' : 'Create transfer request'}</Button></div>
  </form>;
}
