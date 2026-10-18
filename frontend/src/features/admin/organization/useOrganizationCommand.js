import { useLayoutEffect, useRef, useState } from 'react';
import { acknowledgeWriteResponse } from '@/lib/api/v2/writeUncertainty';
import { useScopedNotifications } from '@/shared/hooks/useScopedNotifications';
import { useCommandTransportLifetime } from '@/shared/hooks/useCommandTransportLifetime';
import { organizationApi } from './api';
import { errorCopy } from './model';
const initial = { pending: false, unknown: false, saved: null, error: null, refreshFailed: false };
export function useOrganizationCommand(scope, onDenied, onRecorded) {
  const operation = useRef(null), frozen = useRef(null); const capture = useScopedNotifications(scope);
  const [state, setState] = useState(initial);
  const interrupted = useCommandTransportLifetime(operation, () => setState(old => old.saved ? { ...old, pending: false } : { ...old, pending: false, unknown: true, error: 'Sign-in proof changed while this request was pending. Check the original result or explicitly retry the unchanged change.' }));
  useLayoutEffect(() => () => { operation.current?.abort(); frozen.current = null; }, []);
  const run = async (input = null, recover = false) => {
    if (operation.current || state.saved) return;
    if (!frozen.current && input) frozen.current = structuredClone(input);
    const command = frozen.current; if (!command) return;
    const lease = capture(); if (!lease.isCurrent()) return;
    const controller = new AbortController(); operation.current = controller; setState(old => ({ ...old, pending: true, error: null }));
    try {
      const saved = recover ? await organizationApi.recover(command, { signal: controller.signal }) : await organizationApi.write(command, { signal: controller.signal });
      if (controller.signal.aborted || !lease.isCurrent()) return;
      if (recover && command.uncertainty) acknowledgeWriteResponse(command.uncertainty);
      setState({ ...initial, saved });
      try { await onRecorded(); } catch { if (!controller.signal.aborted && lease.isCurrent()) setState(old => ({ ...old, refreshFailed: true })); }
    } catch (error) {
      if (interrupted(controller)) { if (error.name === 'OrganizationUnconfirmedError' && frozen.current === command && !command.uncertainty) command.uncertainty = error; return; }
      if (controller.signal.aborted || !lease.isCurrent()) return;
      if (error.status === 403) { frozen.current = null; onDenied(); return; }
      const unknown = state.unknown || recover || error.name === 'OrganizationUnconfirmedError';
      if (error.name === 'OrganizationUnconfirmedError' && !command.uncertainty) command.uncertainty = error;
      if (!unknown) frozen.current = null;
      setState(old => ({ ...old, pending: false, unknown, error: unknown ? 'This change may already be recorded. Check the original result or explicitly retry the same reviewed request. A missing result does not authorize a new change.' : errorCopy(error) }));
    } finally { if (operation.current === controller) operation.current = null; }
  };
  const reset = () => { if (operation.current || state.unknown) return; frozen.current = null; setState(initial); };
  return { ...state, frozen: frozen.current, run, reset, busy: state.pending || Boolean(operation.current), locked: state.pending || state.unknown || Boolean(state.saved) };
}
