import { useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { acknowledgeWriteResponse } from '@/lib/api/v2/writeUncertainty';
import { useScopedNotifications } from '@/shared/hooks/useScopedNotifications';
import { useCommandTransportLifetime } from '@/shared/hooks/useCommandTransportLifetime';
import { hashQueryValue } from '@/shared/lib/privateQueryKey';
import { invalidatePrescriptionMutationQueries } from '@/hooks/usePrescriptionMutations';
import { treatmentApi } from './api';
import { treatmentKeys } from './keys';

export function useTreatmentCommand(scope, proof, onDenied) {
  const client = useQueryClient(); const operation = useRef(null); const frozen = useRef(null);
  const capture = useScopedNotifications(hashQueryValue(JSON.stringify([proof, scope.patientId, scope.caseId])));
  const [state, setState] = useState({ pending: false, unknown: false, saved: null, error: null, refreshFailed: false });
  const interrupted = useCommandTransportLifetime(operation, () => setState((old) => old.saved ? { ...old, pending: false } : { ...old, pending: false, unknown: true, error: 'The sign-in proof changed while the request was pending. Check its original result or explicitly retry the unchanged request.' }));
  useLayoutEffect(() => () => operation.current?.abort(), []);
  const run = async (input, recover = false) => {
    if (operation.current || state.saved) return;
    if (!frozen.current && input) frozen.current = structuredClone(input);
    const command = frozen.current; if (!command) return;
    const origin = capture(); if (!origin.isCurrent()) return;
    const controller = new AbortController(); operation.current = controller;
    setState((old) => ({ ...old, pending: true, error: null }));
    try {
      const saved = recover ? await treatmentApi.recover(command, { signal: controller.signal }) : await treatmentApi.write(command, { signal: controller.signal });
      if (controller.signal.aborted || !origin.isCurrent()) return;
      if (recover && command.uncertainty) acknowledgeWriteResponse(command.uncertainty);
      setState({ pending: false, unknown: false, saved, error: null, refreshFailed: false });
      try {
        await Promise.all([client.invalidateQueries({ queryKey: treatmentKeys.admission(proof, scope.patientId, scope.caseId) }, { throwOnError: true }), invalidatePrescriptionMutationQueries(client, { prescriptionId: command.source.summary.prescription_id, patientId: scope.patientId })]);
      } catch { if (!controller.signal.aborted && origin.isCurrent()) setState((old) => ({ ...old, refreshFailed: true })); }
    } catch (error) {
      if (interrupted(controller)) { if (error.name === 'TreatmentWriteUnconfirmedError' && frozen.current === command && !command.uncertainty) command.uncertainty = error; return; }
      if (controller.signal.aborted || !origin.isCurrent()) return;
      const unknown = state.unknown || recover || error.name === 'TreatmentWriteUnconfirmedError';
      if (error.name === 'TreatmentWriteUnconfirmedError' && !command.uncertainty) command.uncertainty = error;
      if (!unknown) frozen.current = null;
      if (error.status === 403) onDenied();
      setState((old) => ({ ...old, pending: false, unknown, error: unknown ? 'This change may already be recorded. Check the original result or explicitly retry the same reviewed request. A missing result does not authorize a new change.' : error.message || 'The course could not be changed. Reload the current admission and course.' }));
    } finally { if (operation.current === controller) operation.current = null; }
  };
  const reset = () => { if (operation.current || state.unknown) return; frozen.current = null; setState({ pending: false, unknown: false, saved: null, error: null, refreshFailed: false }); };
  return { ...state, frozen: frozen.current, run, reset, busy: Boolean(operation.current) || state.pending, locked: state.pending || state.unknown || Boolean(state.saved) };
}
