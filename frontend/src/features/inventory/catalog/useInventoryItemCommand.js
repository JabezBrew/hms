import { useLayoutEffect, useRef, useState } from 'react';
import { acknowledgeWriteResponse, assertWriteRecoveryReadCurrent, markWriteResponseUncertain } from '@/lib/api/v2/writeUncertainty';
import { isCurrentReadDenial } from '@/lib/api/v2/readDenials';
import { useScopedNotifications } from '@/shared/hooks/useScopedNotifications';
import { useCommandTransportLifetime } from '@/shared/hooks/useCommandTransportLifetime';
import { inventoryCatalogApi } from './api';
import { errorCopy, validateCommand } from './model';
const initial = { pending: false, unknown: false, saved: null, error: null, refreshFailed: false };
const uncertainCopy = 'This change may already be recorded. Check the original result or explicitly retry the unchanged reviewed request. A missing result does not authorize a new change.';
export function useInventoryItemCommand(access, onDenied, onRecorded) {
  const operation = useRef(null), fixed = useRef(null), uncertainty = useRef(null), mounted = useRef(false), savedResult = useRef(null);
  const capture = useScopedNotifications(access.scope), [state, setState] = useState(initial);
  const interrupt = () => setState(old => old.saved ? { ...old, pending: false } : { ...old, pending: false, unknown: true, error: uncertainCopy });
  const interrupted = useCommandTransportLifetime(operation, interrupt);
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current?.abort(); operation.current = null; fixed.current = null; uncertainty.current = null; savedResult.current = null; }; }, []);
  useLayoutEffect(() => {
    const attempt = operation.current;
    // A recovery GET must deliver its genuine denial witness even when its own
    // HTTP403 invalidates the clock. It can never publish a successful stale read.
    if (!access.canWrite && attempt && attempt.mode === 'write') { operation.current = null; attempt.abort(); interrupt(); }
  }, [access.canWrite]);
  const run = async (input = null, recover = false) => {
    if (operation.current || savedResult.current || (recover ? !access.canRecover : !access.canWrite)) return;
    if (!fixed.current && input) fixed.current = structuredClone(input);
    const retained = fixed.current; if (!retained) return;
    const lease = capture(); if (!lease.isCurrent()) return;
    const controller = new AbortController(); controller.mode = recover ? 'read' : 'write'; operation.current = controller; setState(old => ({ ...old, pending: true, error: null }));
    let response;
    try {
      const command = await validateCommand(retained);
      if (controller.signal.aborted || operation.current !== controller || !lease.isCurrent()) return;
      const result = recover ? await inventoryCatalogApi.recover(command, { signal: controller.signal }) : await inventoryCatalogApi.write(command, { signal: controller.signal }); response = result.response;
      if (controller.signal.aborted || operation.current !== controller || !mounted.current || !lease.isCurrent()) {
        if (!recover) { try { markWriteResponseUncertain(response); uncertainty.current = response; } catch { /* Keep storage-fault barrier and fixed RAM intent. */ } }
        return;
      }
      if (recover) { assertWriteRecoveryReadCurrent(response); if (uncertainty.current) acknowledgeWriteResponse(uncertainty.current); }
      else acknowledgeWriteResponse(response);
      // No await between final proof/ACK checks and private publication.
      savedResult.current = result.receipt; setState({ ...initial, saved: result.receipt });
      try { await onRecorded(); } catch { if (mounted.current && operation.current === controller && lease.isCurrent()) setState(old => ({ ...old, refreshFailed: true })); }
    } catch (error) {
      if (error.name === 'InventoryItemUnconfirmedError' && fixed.current === retained) uncertainty.current ||= error;
      if (!controller.signal.aborted && mounted.current && operation.current === controller && recover && isCurrentReadDenial(error)) { onDenied(); return; }
      if (interrupted(controller) || controller.signal.aborted || operation.current !== controller || !mounted.current || !lease.isCurrent()) return;
      if (error.status === 403) { onDenied(); return; }
      const unknown = state.unknown || recover || error.name === 'InventoryItemUnconfirmedError' || Boolean(response);
      if (!unknown) fixed.current = null;
      setState(old => ({ ...old, unknown, pending: false, error: unknown ? uncertainCopy : error.status ? errorCopy(error) : error.message }));
    } finally {
      if (operation.current === controller) { operation.current = null; if (mounted.current) setState(old => ({ ...old, pending: false, ...(!savedResult.current && fixed.current && !lease.isCurrent() ? { unknown: true, error: uncertainCopy } : {}) })); }
    }
  };
  const reset = () => { if (operation.current || state.unknown) return; fixed.current = null; uncertainty.current = null; savedResult.current = null; setState(initial); };
  return { ...state, run, reset, frozen: fixed.current, busy: state.pending || Boolean(operation.current), locked: state.pending || state.unknown || Boolean(state.saved) };
}
