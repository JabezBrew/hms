import { useLayoutEffect, useRef, useState } from 'react';
import { laboratoryCatalogCommandRecoveryCandidate, assertWriteRecoveryReadCurrent } from '@/lib/api/v2/writeUncertainty';
import { isCurrentReadDenial } from '@/lib/api/v2/readDenials';
import { useScopedNotifications } from '@/shared/hooks/useScopedNotifications';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { laboratoryCatalogApi } from '../api';
import { CatalogReceipt } from './CatalogResult';
export function CatalogReloadRecovery({ access, onDenied }) {
 const [state, setState] = useState({ busy: false, receipt: null, error: null }), operation = useRef(null), mounted = useRef(false), capture = useScopedNotifications(access.scope);
 useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current?.abort(); operation.current = null; }; }, []);
 const find = async () => {
  if (operation.current || !access.canRecover) return;
  const lease = capture(), controller = new AbortController(); operation.current = controller; setState({ busy: true, receipt: null, error: null });
  try {
   const id = await laboratoryCatalogCommandRecoveryCandidate();
   if (!id) throw new Error('One original catalog availability request could not be identified. Keep the recovery notice unresolved.');
   if (controller.signal.aborted || !lease.isCurrent()) return;
   const result = await laboratoryCatalogApi.original(id, access.user.id, { signal: controller.signal });
   if (!controller.signal.aborted && mounted.current && operation.current === controller && lease.isCurrent()) { assertWriteRecoveryReadCurrent(result.response); setState({ busy: false, receipt: result.receipt, lease, error: null }); }
  } catch (error) {
   if (!controller.signal.aborted && mounted.current && operation.current === controller && isCurrentReadDenial(error)) onDenied();
   else if (!controller.signal.aborted && mounted.current && operation.current === controller && lease.isCurrent()) setState({ busy: false, receipt: null, error: 'The original result could not be confirmed. A missing receipt, current catalog availability or general history does not authorize a new change. Notices without one identifiable original request remain unresolved.' });
  } finally { if (operation.current === controller) { operation.current = null; if (mounted.current) setState(old => ({ ...old, busy: false })); } }
 };
 return <Alert><AlertTitle>Find an original catalog availability result</AlertTitle><AlertDescription><div className="grid gap-3"><p>After reload, the original submitted values are unavailable and cannot be retried here. One retained request reference can locate the original result recorded for your account.</p>{state.receipt && state.lease?.isCurrent() && <><CatalogReceipt receipt={state.receipt} /><p>Review this original result, then separately acknowledge the recovery notice. Finding it does not submit another change.</p></>}{state.error && <p role="alert">{state.error}</p>}<Button type="button" variant="outline" disabled={!access.canRecover || state.busy} onClick={find}>{state.busy ? 'Checking original catalog availability result…' : 'Find original catalog availability result'}</Button></div></AlertDescription></Alert>;
}
