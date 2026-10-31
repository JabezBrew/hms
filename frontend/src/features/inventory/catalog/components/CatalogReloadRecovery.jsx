import { useLayoutEffect, useRef, useState } from 'react';
import { inventoryItemCommandRecoveryCandidate, assertWriteRecoveryReadCurrent } from '@/lib/api/v2/writeUncertainty';
import { isCurrentReadDenial } from '@/lib/api/v2/readDenials';
import { useScopedNotifications } from '@/shared/hooks/useScopedNotifications';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { inventoryCatalogApi } from '../api';
import { CatalogReceipt } from './CatalogResult';
export function CatalogReloadRecovery({ access, onDenied }) {
 const [state, setState] = useState({ busy: false, receipt: null, error: null }), operation = useRef(null), mounted = useRef(false), capture = useScopedNotifications(access.scope);
 useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current?.abort(); operation.current = null; }; }, []);
 const find = async () => {
  if (operation.current || !access.canRecover) return;
  const lease = capture(), controller = new AbortController(); operation.current = controller; setState({ busy: true, receipt: null, error: null });
  try {
   const id = await inventoryItemCommandRecoveryCandidate();
   if (!id) throw new Error('No single original catalog command can be identified. An old unkeyed or ambiguous recovery notice must remain unresolved.');
   if (controller.signal.aborted || !lease.isCurrent()) return;
   const result = await inventoryCatalogApi.original(id, access.user.id, { signal: controller.signal });
   if (!controller.signal.aborted && mounted.current && operation.current === controller && lease.isCurrent()) { assertWriteRecoveryReadCurrent(result.response); setState({ busy: false, receipt: result.receipt, lease, error: null }); }
  } catch (error) {
   if (!controller.signal.aborted && mounted.current && operation.current === controller && isCurrentReadDenial(error)) onDenied();
   else if (!controller.signal.aborted && mounted.current && operation.current === controller && lease.isCurrent()) setState({ busy: false, receipt: null, error: 'The original result could not be confirmed. A missing receipt, current item or general history does not authorize a new change. Old unkeyed notices remain unresolved.' });
  } finally { if (operation.current === controller) { operation.current = null; if (mounted.current) setState(old => ({ ...old, busy: false })); } }
 };
 return <Alert><AlertTitle>Find an original catalog result</AlertTitle><AlertDescription><div className="grid gap-3"><p>After reload, the submitted body is unavailable and cannot be retried here. Only a single retained command UUID can locate its original actor-bound result.</p>{state.receipt && state.lease?.isCurrent() && <><CatalogReceipt receipt={state.receipt} /><p>Review this original result, then separately acknowledge the recovery notice. Finding it does not submit another change.</p></>}{state.error && <p role="alert">{state.error}</p>}<Button type="button" variant="outline" disabled={!access.canRecover || state.busy} onClick={find}>{state.busy ? 'Checking original catalog result…' : 'Find original catalog result'}</Button></div></AlertDescription></Alert>;
}
