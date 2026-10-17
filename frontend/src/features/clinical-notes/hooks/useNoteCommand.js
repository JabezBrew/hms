import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { acknowledgeWriteResponse } from '@/lib/api/v2/writeUncertainty';
import { invalidatePatientTimelineQueries } from '@/hooks/useTimelineQueries';
import { noteWorkspaceApi } from '../api/workspace';
import { noteKeys } from '../keys';
import { useScopedNotifications } from '@/shared/hooks/useScopedNotifications';
import { hashQueryValue } from '@/shared/lib/privateQueryKey';
import { useCommandTransportLifetime } from '@/shared/hooks/useCommandTransportLifetime';

export function useNoteCommand(scope, patientId, onSaved) {
  const client = useQueryClient(); const operation = useRef(null); const frozen = useRef(null);
  const { user } = useAuth();
  const capture = useScopedNotifications(patientId ? hashQueryValue(patientId) : null);
  const [state, setState] = useState({ pending: false, unknown: false, saved: null, error: null, refreshFailed: false });
  const interrupted = useCommandTransportLifetime(operation, () => setState((old) => old.saved ? { ...old, pending: false } : { ...old, pending: false, unknown: true, error: 'The sign-in proof changed while this request was pending. Its result is unconfirmed. Check the original result or explicitly retry the unchanged request.' }));
  useEffect(() => () => operation.current?.abort(), []);
  const run = async (input, recover = false) => {
    if (operation.current || state.saved) return;
    const original = frozen.current || input; if (!original) return;
    // The command is immutable after dispatch. Never persist clinical payloads.
    if (!frozen.current) frozen.current = { ...structuredClone(original), actorId: user?.id };
    const command = frozen.current; const controller = new AbortController(); const lease = capture(); operation.current = controller;
    setState((old) => ({ ...old, pending: true, error: null }));
    try {
      const saved = recover ? await noteWorkspaceApi.recover(command, { signal: controller.signal }) : await noteWorkspaceApi.write(command, { signal: controller.signal });
      if (controller.signal.aborted || !lease.isCurrent()) return;
      if (recover && command.uncertainty) acknowledgeWriteResponse(command.uncertainty);
      setState({ pending: false, unknown: false, saved, error: null, refreshFailed: false });
      try { onSaved?.(saved); } catch { /* A callback cannot undo a confirmed saved receipt. */ }
      try { await Promise.all([client.invalidateQueries({ queryKey: command.kind.startsWith('template') ? noteKeys.templates(scope) : noteKeys.patient(scope, patientId) }), ...(patientId ? [invalidatePatientTimelineQueries(client, patientId)] : [])]); }
      catch { if (!controller.signal.aborted && lease.isCurrent()) setState((old) => ({ ...old, refreshFailed: true })); }
    } catch (error) {
      if (interrupted(controller)) { if (error.name === 'ClinicalNoteUnconfirmedError' && frozen.current === command && !command.uncertainty) command.uncertainty = error; return; }
      if (controller.signal.aborted || !lease.isCurrent()) return;
      const unknown = state.unknown || recover || error.name === 'ClinicalNoteUnconfirmedError';
      if (error.name === 'ClinicalNoteUnconfirmedError' && !command.uncertainty) command.uncertainty = error;
      if (!unknown) frozen.current = null;
      setState((old) => ({ ...old, pending: false, unknown, error: unknown ? 'The change may already be saved. Check the original saved result or retry the exact unchanged request. A missing result does not authorize a new save.' : error.message || 'This change could not be saved.' }));
    } finally { if (operation.current === controller) operation.current = null; }
  };
  const reset = () => { if (operation.current || state.unknown) return; frozen.current = null; setState({ pending: false, unknown: false, saved: null, error: null, refreshFailed: false }); };
  return { ...state, run, reset, frozen: frozen.current, busy: state.pending || Boolean(operation.current) };
}
