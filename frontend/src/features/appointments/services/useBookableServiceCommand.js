import { useLayoutEffect, useRef, useState } from 'react';
import { acknowledgeWriteResponse } from '@/lib/api/v2/writeUncertainty';
import { useReadOnlyMode } from '@/contexts/ReadOnlyModeContext';
import { networkDecisionDenialPending } from '@/features/settings/network/useNetworkDecisionExpired';
import { isCurrentReadDenial } from '@/lib/api/v2/readDenials';
import { useScopedNotifications } from '@/shared/hooks/useScopedNotifications';
import { useCommandTransportLifetime } from '@/shared/hooks/useCommandTransportLifetime';
import { serviceApi } from './api';
import { errorCopy } from './model';
const initial = { pending: false, unknown: false, saved: null, error: null, refreshFailed: false };
export function useBookableServiceCommand(scope, canWrite, onDenied, onRecorded) {
  const network = useReadOnlyMode({ optional: true }), recoveryClock = useRef(null), mounted = useRef(false);
  const operation = useRef(null), frozen = useRef(null), interruptedAccess = useRef(new WeakSet()); const capture = useScopedNotifications(scope);
  const [state, setState] = useState(initial);
  const interrupted = useCommandTransportLifetime(operation, () => setState(old => old.saved ? { ...old, pending: false } : { ...old, pending: false, unknown: true, error: 'Sign-in proof changed while this request was pending. Check the original result or explicitly retry the unchanged change.' }));
  useLayoutEffect(() => {
    if (!canWrite && operation.current) {
      const controller = operation.current;
      if (recoveryClock.current?.operation === controller && networkDecisionDenialPending(recoveryClock.current.decision)) return;
      interruptedAccess.current.add(controller); operation.current = null; controller.abort();
      setState(old => old.saved ? { ...old, pending: false } : { ...old, pending: false, unknown: true, error: 'Write access changed while the request was pending. Its exact original request remains available for reconciliation.' });
    }
  }, [canWrite, network?.networkDecision]);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current?.abort(); operation.current = null; recoveryClock.current = null; frozen.current = null; }; }, []);
  const run = async (input = null, recover = false) => {
    if (operation.current || state.saved || (!recover && !canWrite)) return;
    if (!frozen.current && input) frozen.current = structuredClone(input);
    const command = frozen.current; if (!command) return;
    const lease = capture(); if (!lease.isCurrent()) return;
    const controller = new AbortController(); operation.current = controller; recoveryClock.current = recover ? { operation: controller, decision: network?.networkDecision } : null; setState(old => ({ ...old, pending: true, error: null }));
    try {
      const saved = recover ? await serviceApi.recover(command, { signal: controller.signal }) : await serviceApi.write(command, { signal: controller.signal });
      if (controller.signal.aborted || !mounted.current || operation.current !== controller || !lease.isCurrent()) return;
      if (recover && command.uncertainty) acknowledgeWriteResponse(command.uncertainty);
      setState({ ...initial, saved });
      try { await onRecorded(); } catch { if (!controller.signal.aborted && lease.isCurrent()) setState(old => ({ ...old, refreshFailed: true })); }
    } catch (error) {
      if (recover && !controller.signal.aborted && mounted.current && operation.current === controller && isCurrentReadDenial(error)) {
        if (error.data?.error?.code === 'reauth_required') setState(old => ({ ...old, pending: false, unknown: true, error: 'Current credentials must be confirmed before the original result can be checked. The earlier change remains unresolved.' }));
        else onDenied();
        return;
      }
      if (interrupted(controller) || interruptedAccess.current.has(controller)) { if (error.name === 'ServiceUnconfirmedError' && frozen.current === command && !command.uncertainty) command.uncertainty = error; return; }
      if (controller.signal.aborted || !mounted.current || operation.current !== controller || !lease.isCurrent()) return;
      if (!recover && error.status === 403 && error.data?.error?.code !== 'reauth_required') { frozen.current = null; onDenied(); return; }
      const unknown = state.unknown || recover || error.name === 'ServiceUnconfirmedError';
      if (error.name === 'ServiceUnconfirmedError' && !command.uncertainty) command.uncertainty = error;
      if (!unknown) frozen.current = null;
      setState(old => ({ ...old, pending: false, unknown, error: unknown ? 'This change may already be recorded. Check the original result or explicitly retry the same reviewed request. A missing result does not authorize a new change.' : errorCopy(error) }));
    } finally { if (operation.current === controller) { operation.current = null; recoveryClock.current = null; if (mounted.current) setState(old => ({ ...old, pending: false })); } }
  };
  const reset = () => { if (operation.current || state.unknown) return; frozen.current = null; setState(initial); };
  return { ...state, frozen: frozen.current, run, reset, busy: state.pending || Boolean(operation.current), locked: state.pending || state.unknown || Boolean(state.saved) };
}
