import { useLayoutEffect, useRef, useState } from 'react';
import { organizationCommandRecoveryCandidate } from '@/lib/api/v2/writeUncertainty';
import { useScopedNotifications } from '@/shared/hooks/useScopedNotifications';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { organizationApi } from '../api';
export function OrganizationReloadRecovery({ access, onDenied }) {
  const [state, setState] = useState({ busy: false, receipt: null, error: null }); const operation = useRef(null), capture = useScopedNotifications(access.scope);
  useLayoutEffect(() => () => operation.current?.abort(), []);
  const find = async () => {
    if (operation.current || !access.canRecover) return;
    const lease = capture(), controller = new AbortController(); operation.current = controller; setState({ busy: true, receipt: null, error: null });
    try {
      const requestId = await organizationCommandRecoveryCandidate();
      if (!requestId) throw new Error('No single original organization command can be identified in this sign-in scope. Keep the recovery notice unresolved.');
      if (controller.signal.aborted || !lease.isCurrent()) return;
      const receipt = await organizationApi.original(requestId, access.user.id, { signal: controller.signal });
      if (!controller.signal.aborted && lease.isCurrent()) setState({ busy: false, receipt, error: null });
    } catch (error) { if (!controller.signal.aborted && lease.isCurrent()) { if (error.status === 403) onDenied(); else setState({ busy: false, receipt: null, error: 'The original organization result could not be confirmed. A missing or unavailable receipt does not authorize a new change.' }); } }
    finally { if (operation.current === controller) operation.current = null; }
  };
  return <Alert><AlertTitle>Recover an original organization result</AlertTitle><AlertDescription><div className="grid gap-3"><p>After a reload, the submitted body is unavailable and cannot be retried here. An exact original result can be read if one current organization command is identified.</p>{state.receipt && <div className="grid gap-1 break-words"><p>Original action: {state.receipt.reviewed_input.action}. Unit: {state.receipt.unit.name} ({state.receipt.unit.code}).</p><p>{state.receipt.unit.is_active ? 'Active' : 'Inactive'} · Version {state.receipt.unit.version} · {state.receipt.changed ? 'Change recorded' : 'Recorded without a unit change'}</p><p>Review this immutable result, then separately acknowledge the recovery notice above. This result may predate the current directory state.</p></div>}{state.error && <p role="alert">{state.error}</p>}<Button type="button" variant="outline" disabled={state.busy || !access.canRecover} onClick={find}>{state.busy ? 'Checking original result…' : 'Find original organization result'}</Button></div></AlertDescription></Alert>;
}
