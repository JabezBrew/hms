import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { acknowledgeWriteResponse } from '@/lib/api/v2/writeUncertainty';
import { handoverApi } from './api';
import { handoverKeys } from './keys';

export function useHandoverCommand(scope, patientId, onSaved) {
  const client = useQueryClient(); const operation = useRef(null); const frozen = useRef(null);
  const [state, setState] = useState({ pending: false, unknown: false, saved: null, error: null, refreshFailed: false });
  useEffect(() => () => operation.current?.abort(), []);
  const run = async (command, recover = false) => {
    if (operation.current || state.saved) return;
    const original = frozen.current || command; if (!original) return;
    frozen.current = original; const controller = new AbortController(); operation.current = controller;
    setState((old) => ({ ...old, pending: true, error: null }));
    try {
      const saved = recover ? await handoverApi.recover(original, { signal: controller.signal }) : await handoverApi.write(original, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (recover && original.uncertainty) acknowledgeWriteResponse(original.uncertainty);
      setState({ pending: false, unknown: false, saved, error: null, refreshFailed: false });
      try { onSaved?.(); } catch { /* Saved persistence must remain confirmed even if a consumer fails. */ }
      try { await client.invalidateQueries({ queryKey: handoverKeys.patient(scope, patientId) }); } catch { setState((old) => ({ ...old, refreshFailed: true })); }
    } catch (error) {
      if (controller.signal.aborted) return;
      const unknown = state.unknown || recover || error.name === 'HandoverUnconfirmedError';
      if (error.name === 'HandoverUnconfirmedError' && !original.uncertainty) original.uncertainty = error;
      if (!unknown) frozen.current = null;
      setState((old) => ({ ...old, pending: false, unknown, error: unknown ? 'The change may already be saved. Check the original result or retry the exact unchanged request. A missing result does not authorize a new request.' : error.message || 'The handover could not be changed.' }));
    } finally { if (operation.current === controller) operation.current = null; }
  };
  const reset = () => { if (operation.current || state.unknown) return; frozen.current = null; setState({ pending: false, unknown: false, saved: null, error: null, refreshFailed: false }); };
  return { ...state, busy: Boolean(operation.current) || state.pending, frozen: frozen.current, run, reset };
}
