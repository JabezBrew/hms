import { useLayoutEffect, useRef, useState } from 'react';
import { previewNoteTemplate } from '../api/templatePreview';
import { applyTemplatePreview } from '../templatePreviewModel';

// Ephemeral read state. It never enters the command/recovery controller.
export function useTemplatePreview({ patientId, encounterId, revision, body, scope, enabled, onApply, onDenied }) {
  const binding = JSON.stringify([patientId, encounterId, revision?.id, revision?.template_id, revision?.version, revision?.body_template, body, scope, enabled]);
  const operation = useRef(null); const latest = useRef(binding);
  const [state, setState] = useState({ binding: null, pending: false, result: null, error: null, denied: false });
  useLayoutEffect(() => {
    latest.current = binding; operation.current?.abort(); operation.current = null;
    setState({ binding, pending: false, result: null, error: null, denied: false });
    return () => operation.current?.abort();
  }, [binding]);
  const current = state.binding === binding ? state : { pending: false, result: null, error: null, denied: false };
  const run = async ({ mode, sections, chiefComplaint }) => {
    if (!enabled || !revision) return;
    operation.current?.abort(); const controller = new AbortController(); operation.current = controller; const captured = binding;
    setState({ binding: captured, pending: true, result: null, error: null, denied: false });
    try {
      const result = await previewNoteTemplate({ patientId, encounterId, revision, body, mode, sections, chiefComplaint }, { signal: controller.signal });
      if (controller.signal.aborted || latest.current !== captured) return;
      setState({ binding: captured, pending: false, result, error: null, denied: false });
    } catch (error) {
      if (controller.signal.aborted || latest.current !== captured) return;
      if (error.status === 403) onDenied?.();
      setState({ binding: captured, pending: false, result: null, error: error.status === 403 ? 'Current patient or template access could not be confirmed. Protected preview content is hidden.' : error.message || 'This preview could not be confirmed.', denied: error.status === 403 });
    } finally { if (operation.current === controller) operation.current = null; }
  };
  const apply = () => {
    if (latest.current !== binding || !enabled || !current.result || current.pending || current.denied) return;
    try { const next = applyTemplatePreview(body, current.result.preview, current.result.payload); onApply(next); setState({ binding, pending: false, result: null, error: null, denied: false }); }
    catch (error) { setState((old) => ({ ...old, error: error.message })); }
  };
  return { ...current, run, apply, clear: () => { operation.current?.abort(); setState({ binding, pending: false, result: null, error: null, denied: false }); } };
}
