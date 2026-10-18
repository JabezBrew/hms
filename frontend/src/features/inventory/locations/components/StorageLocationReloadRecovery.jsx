import { useLayoutEffect, useRef, useState } from 'react';
import { storageLocationCommandRecoveryCandidate } from '@/lib/api/v2/writeUncertainty';
import { useScopedNotifications } from '@/shared/hooks/useScopedNotifications';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { storageLocationApi } from '../api';
export function StorageLocationReloadRecovery({ access, onDenied }) {
  const [state, setState] = useState({ busy: false, receipt: null, error: null }); const operation = useRef(null), capture = useScopedNotifications(access.scope);
  useLayoutEffect(() => () => operation.current?.abort(), []);
  const find = async () => {
    if (operation.current || !access.canRecover) return;
    const lease = capture(), controller = new AbortController(); operation.current = controller; setState({ busy: true, receipt: null, error: null });
    try {
      const requestId = await storageLocationCommandRecoveryCandidate();
      if (!requestId) throw new Error('No single original storage location command can be identified in this sign-in scope. Keep the recovery notice unresolved.');
      if (controller.signal.aborted || !lease.isCurrent()) return;
      const receipt = await storageLocationApi.original(requestId, access.user.id, { signal: controller.signal });
      if (!controller.signal.aborted && lease.isCurrent()) setState({ busy: false, receipt, error: null });
    } catch (error) { if (!controller.signal.aborted && lease.isCurrent()) { if (error.status === 403) onDenied(); else setState({ busy: false, receipt: null, error: 'The original storage location result could not be confirmed. A missing or unavailable receipt does not authorize a new change.' }); } }
    finally { if (operation.current === controller) operation.current = null; }
  };
  return <Alert><AlertTitle>Recover an original storage location result</AlertTitle><AlertDescription><div className="grid gap-3"><p>After a reload, the submitted body is unavailable and cannot be retried here. An exact original result can be read if one current storage location command is identified.</p>{state.receipt && <div className="grid gap-1 break-words"><p>Original action: {state.receipt.reviewed_input.action}. Location: {state.receipt.location.name} ({state.receipt.location.code}).</p><p>{state.receipt.location.is_active ? 'Active' : 'Inactive'} · Version {state.receipt.location.version} · {state.receipt.changed ? 'Change recorded' : 'Recorded without a location change'}</p><p>Review this immutable result, then separately acknowledge the recovery notice above. This result may predate the current directory state.</p></div>}{state.error && <p role="alert">{state.error}</p>}<Button type="button" variant="outline" disabled={state.busy || !access.canRecover} onClick={find}>{state.busy ? 'Checking original result…' : 'Find original storage location result'}</Button></div></AlertDescription></Alert>;
}
