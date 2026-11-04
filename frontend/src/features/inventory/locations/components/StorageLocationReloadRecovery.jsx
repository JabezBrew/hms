import { useLayoutEffect, useRef, useState } from 'react';
import { storageLocationCommandRecoveryCandidate } from '@/lib/api/v2/writeUncertainty';
import { isCurrentReadDenial } from '@/lib/api/v2/readDenials';
import { useScopedNotifications } from '@/shared/hooks/useScopedNotifications';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { storageLocationApi } from '../api';
export function StorageLocationReloadRecovery({ access, onDenied }) {
  const [state, setState] = useState({ busy: false, receipt: null, error: null }); const operation = useRef(null), mounted = useRef(false), capture = useScopedNotifications(access.scope);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current?.abort(); operation.current = null; }; }, []);
  const find = async () => {
    if (operation.current || !access.canRecover) return;
    const lease = capture(), controller = new AbortController(); operation.current = controller; setState({ busy: true, receipt: null, error: null });
    try {
      const requestId = await storageLocationCommandRecoveryCandidate();
      if (!requestId) throw new Error('No single original storage location command can be identified in this sign-in scope. Keep the recovery notice unresolved.');
      if (controller.signal.aborted || !lease.isCurrent()) return;
      const receipt = await storageLocationApi.original(requestId, access.user.id, { signal: controller.signal });
      if (!controller.signal.aborted && mounted.current && operation.current === controller && lease.isCurrent()) setState({ busy: false, receipt, lease, error: null });
    } catch (error) {
      if (!controller.signal.aborted && mounted.current && operation.current === controller && isCurrentReadDenial(error)) {
        if (error.data?.error?.code === 'reauth_required') setState({ busy: false, receipt: null, error: 'Current credentials must be confirmed before the original result can be checked. The earlier change remains unresolved.' });
        else onDenied();
      } else if (!controller.signal.aborted && mounted.current && operation.current === controller && lease.isCurrent()) setState({ busy: false, receipt: null, error: 'The original storage location result could not be confirmed. A missing or unavailable receipt does not authorize a new change.' });
    } finally { if (operation.current === controller) { operation.current = null; if (mounted.current) setState(old => ({ ...old, busy: false })); } }
  };
  return <Alert><AlertTitle>Recover an original storage location result</AlertTitle><AlertDescription><div className="grid gap-3"><p>After a reload, the submitted body is unavailable and cannot be retried here. An exact original result can be read if one current storage location command is identified.</p>{state.receipt && state.lease?.isCurrent() && <div className="grid gap-1 break-words"><p>Original action: {state.receipt.reviewed_input.action}. Location: {state.receipt.location.name} ({state.receipt.location.code}).</p><p>{state.receipt.location.is_active ? 'Active' : 'Inactive'} · Version {state.receipt.location.version} · {state.receipt.changed ? 'Change recorded' : 'Recorded without a location change'}</p><p>Review this immutable result, then separately acknowledge the recovery notice above. This result may predate the current directory state.</p></div>}{state.error && <p role="alert">{state.error}</p>}<Button type="button" variant="outline" disabled={state.busy || !access.canRecover} onClick={find}>{state.busy ? 'Checking original result…' : 'Find original storage location result'}</Button></div></AlertDescription></Alert>;
}
