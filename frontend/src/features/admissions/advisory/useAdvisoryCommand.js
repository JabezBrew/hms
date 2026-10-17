import { useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { acknowledgeWriteResponse } from '@/lib/api/v2/writeUncertainty';
import { hashQueryValue } from '@/shared/lib/privateQueryKey';
import { useScopedNotifications } from '@/shared/hooks/useScopedNotifications';
import { advisoryApi } from './api';
import { advisoryKeys } from './keys';

export function useAdvisoryCommand(scope, patientId, caseId, onDenied) {
  const client = useQueryClient(); const operation = useRef(null); const frozen = useRef(null);
  const capture = useScopedNotifications(hashQueryValue(JSON.stringify([scope, patientId, caseId])));
  const [state, setState] = useState({ pending: false, unknown: false, saved: null, error: null, refreshFailed: false });
  useLayoutEffect(() => () => operation.current?.abort(), []);
  const run = async (input, recover = false) => {
    if (operation.current || state.saved) return;
    if (!frozen.current && input) frozen.current = structuredClone(input);
    const command = frozen.current; if (!command) return;
    const controller = new AbortController(); const origin = capture(); operation.current = controller;
    setState((old) => ({ ...old, pending: true, error: null }));
    try {
      const saved = recover ? await advisoryApi.recover(command, { signal: controller.signal }) : await advisoryApi.write(command, { signal: controller.signal });
      if (controller.signal.aborted || !origin.isCurrent()) return;
      if (recover && command.uncertainty) acknowledgeWriteResponse(command.uncertainty);
      setState({ pending: false, unknown: false, saved, error: null, refreshFailed: false });
      try { await client.invalidateQueries({ queryKey: advisoryKeys.context(scope, patientId, caseId) }, { throwOnError: true }); }
      catch { if (!controller.signal.aborted && origin.isCurrent()) setState((old) => ({ ...old, refreshFailed: true })); }
    } catch (error) {
      if (controller.signal.aborted || !origin.isCurrent()) return;
      const unknown = state.unknown || recover || error.name === 'AdvisoryUnconfirmedError';
      if (error.name === 'AdvisoryUnconfirmedError' && !command.uncertainty) command.uncertainty = error;
      if (!unknown) frozen.current = null;
      if (error.status === 403) onDenied();
      if (!unknown && error.status === 409) client.invalidateQueries({ queryKey: advisoryKeys.context(scope, patientId, caseId) });
      setState((old) => ({ ...old, pending: false, unknown, error: unknown ? 'This change may already be recorded. Check the original result or retry the exact reviewed request. A missing result does not authorize a new change.' : 'The change was not confirmed. Review the current admission and task before trying again.' }));
    } finally { if (operation.current === controller) operation.current = null; }
  };
  const reset = () => { if (operation.current || state.unknown) return; frozen.current = null; setState({ pending: false, unknown: false, saved: null, error: null, refreshFailed: false }); };
  return { ...state, frozen: frozen.current, run, reset, locked: state.pending || state.unknown || Boolean(state.saved) };
}
