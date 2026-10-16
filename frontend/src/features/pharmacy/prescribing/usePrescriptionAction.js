import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { invalidatePrescriptionMutationQueries, prescriptionKeys } from '@/hooks/usePrescriptionMutations';
import { acknowledgeWriteResponse } from '@/lib/api/v2/writeUncertainty';
import { courseApi } from './courseApi';

export function usePrescriptionAction(kind, patientId, onSuccess) {
  const client = useQueryClient(); const operation = useRef(null); const frozen = useRef(null);
  const [state, setState] = useState({ pending: false, unknown: false, saved: null, error: null, refreshFailed: false });
  useEffect(() => () => operation.current?.abort(), []);
  const publishSaved = async (saved) => {
    setState({ pending: false, unknown: false, saved, error: null, refreshFailed: false });
    try { await Promise.all([invalidatePrescriptionMutationQueries(client, { patientId, prescriptionId: frozen.current.source.id }), ...(saved.prescription.id !== frozen.current.source.id ? [client.invalidateQueries({ queryKey: prescriptionKeys.detail(saved.prescription.id) })] : [])]); }
    catch { setState((old) => ({ ...old, refreshFailed: true })); }
    try { onSuccess?.(saved); } catch { /* A confirmed clinical receipt remains confirmed. */ }
  };
  const run = async ({ source, payload, recover = false } = {}) => {
    if (operation.current || state.saved) return;
    const command = frozen.current || { source, payload };
    if (!command.source || !command.payload) return;
    frozen.current = command;
    const controller = new AbortController(); operation.current = controller;
    setState((old) => ({ ...old, pending: true, error: null }));
    try {
      const saved = recover ? await courseApi.recover(kind, command.source, command.payload, { signal: controller.signal }) : await courseApi[kind](command.source, command.payload, { signal: controller.signal });
      if (!controller.signal.aborted) { if (recover && command.uncertainty) acknowledgeWriteResponse(command.uncertainty); await publishSaved(saved); }
    } catch (error) {
      if (controller.signal.aborted) return;
      const unknown = state.unknown || recover || error.name === 'PrescriptionActionUnconfirmedError';
      if (!command.uncertainty && error.name === 'PrescriptionActionUnconfirmedError') command.uncertainty = error;
      if (!unknown) frozen.current = null;
      setState((old) => ({ ...old, pending: false, unknown, error: unknown ? 'The change may already be saved. Check the original saved result or explicitly retry the unchanged request. A missing recovery result does not authorize another request.' : error.message || 'The prescription could not be changed.' }));
    } finally { if (operation.current === controller) operation.current = null; }
  };
  return { ...state, run, frozen: frozen.current, busy: !state.saved && (Boolean(operation.current) || state.pending) };
}
