import { useEffect, useRef, useState } from 'react';
import { acknowledgeWriteResponse } from '@/lib/api/v2/writeUncertainty';
import { useScopedNotifications } from '@/shared/hooks/useScopedNotifications';
import { roundCommandApi } from './commandApi';

export function useRoundCommand(scope, onConfirmed) {
  const controller = useRef(null); const frozen = useRef(null); const capture = useScopedNotifications(scope);
  const [state, setState] = useState({ pending: false, unknown: false, error: null, saved: null, refreshFailed: false });
  useEffect(() => () => controller.current?.abort(), []);
  const run = async (input, recover = false) => {
    if (controller.current) return;
    if (!frozen.current) frozen.current = structuredClone(input);
    const command = frozen.current;
    if (!command) return;
    const abort = new AbortController(); const origin = capture(); controller.current = abort;
    setState((old) => ({ ...old, pending: true, error: null }));
    try {
      const saved = recover ? await roundCommandApi.recover(command, { signal: abort.signal }) : await roundCommandApi.write(command, { signal: abort.signal });
      if (abort.signal.aborted || !origin.isCurrent()) return;
      if (recover && command.uncertainty) acknowledgeWriteResponse(command.uncertainty);
      setState({ pending: true, unknown: false, error: null, saved, refreshFailed: false });
      try {
        await onConfirmed(saved, command, () => !abort.signal.aborted && origin.isCurrent());
        if (abort.signal.aborted || !origin.isCurrent()) return;
        frozen.current = null;
        setState((old) => ({ ...old, pending: false }));
      }
      catch { if (!abort.signal.aborted && origin.isCurrent()) setState((old) => ({ ...old, pending: false, refreshFailed: true })); }
    } catch (error) {
      if (abort.signal.aborted || !origin.isCurrent()) return;
      const unknown = state.unknown || recover || error.name === 'WardRoundUnconfirmedError';
      if (error.name === 'WardRoundUnconfirmedError' && !command.uncertainty) command.uncertainty = error;
      if (!unknown) frozen.current = null;
      setState((old) => ({ ...old, pending: false, unknown, error: unknown ? 'The round may already be saved. Keep this request unchanged. Checking a missing result does not authorize a new save.' : error.message || 'This round could not be saved.' }));
    } finally { if (controller.current === abort) controller.current = null; }
  };
  return { ...state, run, retry: () => run(frozen.current), recover: () => run(frozen.current, true), frozen: frozen.current, busy: state.pending || state.unknown || state.refreshFailed };
}
