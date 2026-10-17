import { useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { acknowledgeWriteResponse } from '@/lib/api/v2/writeUncertainty';
import { useScopedNotifications } from '@/shared/hooks/useScopedNotifications';
import { useCommandTransportLifetime } from '@/shared/hooks/useCommandTransportLifetime';
import { hashQueryValue } from '@/shared/lib/privateQueryKey';
import { admissionMoveApi } from '../api';
import { invalidateMoveViews } from './invalidateMoveViews';
export function useMoveCommand(scope, proof, onDenied, onSaved) {
  const client = useQueryClient(); const operation = useRef(null); const frozen = useRef(null);
  const capture = useScopedNotifications(hashQueryValue(JSON.stringify([proof, scope.patientId, scope.caseId])));
  const [state, setState] = useState({ pending: false, unknown: false, saved: null, error: null, refreshFailed: false });
  const interrupted = useCommandTransportLifetime(operation, () => setState(old => old.saved ? { ...old, pending: false } : { ...old, pending: false, unknown: true, error: 'The sign-in proof changed while this move was pending. Check the original saved result or explicitly retry the unchanged request.' }));
  useLayoutEffect(() => () => operation.current?.abort(), []);
  const run = async (input, recover = false) => {
    if (operation.current || state.saved) return;
    if (!frozen.current && input) frozen.current = structuredClone(input);
    const command = frozen.current; if (!command) return;
    const lease = capture(); if (!lease.isCurrent()) return;
    const controller = new AbortController(); operation.current = controller;
    setState(old => ({ ...old, pending: true, error: null }));
    try {
      const saved = recover ? await admissionMoveApi.recover(command, { signal: controller.signal }) : await admissionMoveApi.write(command, { signal: controller.signal });
      if (controller.signal.aborted || !lease.isCurrent()) return;
      if (recover && command.uncertainty) acknowledgeWriteResponse(command.uncertainty);
      setState({ pending: false, unknown: false, saved, error: null, refreshFailed: false });
      try { await Promise.all([Promise.resolve().then(() => onSaved?.()), invalidateMoveViews(client, scope, proof, command)]); }
      catch { if (!controller.signal.aborted && lease.isCurrent()) setState(old => ({ ...old, refreshFailed: true })); }
    } catch (error) {
      if (interrupted(controller)) { if (error.name === 'AdmissionMoveUnconfirmedError' && frozen.current === command && !command.uncertainty) command.uncertainty = error; return; }
      if (controller.signal.aborted || !lease.isCurrent()) return;
      const unknown = state.unknown || recover || error.name === 'AdmissionMoveUnconfirmedError';
      if (error.name === 'AdmissionMoveUnconfirmedError' && !command.uncertainty) command.uncertainty = error;
      if (!unknown) frozen.current = null;
      if (error.status === 403) onDenied();
      setState(old => ({ ...old, pending: false, unknown, error: unknown ? 'This move may already be recorded. Check the original result or explicitly retry the same reviewed move. A missing result does not authorize a new change.' : error.message || 'The move could not be recorded. Review the current placement before trying again.' }));
    } finally { if (operation.current === controller) operation.current = null; }
  };
  const reset = () => { if (operation.current || state.unknown) return; frozen.current = null; setState({ pending: false, unknown: false, saved: null, error: null, refreshFailed: false }); };
  return { ...state, frozen: frozen.current, run, reset, busy: state.pending || Boolean(operation.current), locked: state.pending || state.unknown || Boolean(state.saved) };
}
