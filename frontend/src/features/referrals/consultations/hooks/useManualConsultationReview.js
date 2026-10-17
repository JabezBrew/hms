import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getV2ClientScopeKey, subscribeV2ClientScope } from '@/lib/api/v2/client';
import { getWriteUncertaintySnapshot, subscribeWriteUncertainty } from '@/lib/api/v2/writeUncertainty';
import { consultationManualReview } from '../recovery';
import { consultationApi } from '../api';
const empty = () => ({ candidate: false, pending: false, result: null, error: null });
export function useManualConsultationReview({ scope, access, current, enabled, onDenied, onRefresh }) {
  const snapshot = useSyncExternalStore(subscribeWriteUncertainty, getWriteUncertaintySnapshot, getWriteUncertaintySnapshot);
  const transport = useSyncExternalStore(subscribeV2ClientScope, getV2ClientScopeKey, getV2ClientScopeKey);
  const binding = JSON.stringify([access.scope, transport, scope.patientId, scope.referralId, current.context_token, current.link_version, enabled]);
  const operation = useRef(null), proof = useRef(null), latest = useRef(binding); const [state, setState] = useState(empty);
  const cancelProof = () => { if (proof.current) void consultationManualReview('cancel', { proof: proof.current }); proof.current = null; };
  useLayoutEffect(() => {
    latest.current = binding; operation.current?.abort(); operation.current = null; cancelProof(); setState(empty());
    return () => { operation.current?.abort(); cancelProof(); };
  }, [binding, snapshot]);
  useEffect(() => {
    if (!enabled || !snapshot.entries.length) return;
    let cancelled = false;
    consultationManualReview('candidate', { scope }).then(candidate => { if (!cancelled) setState(old => ({ ...old, candidate })); }).catch(() => {});
    return () => { cancelled = true; };
  }, [binding, enabled, snapshot, scope]);
  const begin = () => { operation.current?.abort(); const controller = new AbortController(); operation.current = controller; setState(old => ({ ...old, pending: true, result: null, error: null })); return controller; };
  const valid = controller => !controller.signal.aborted && latest.current === binding;
  const fail = (controller, error) => { if (!valid(controller)) return; cancelProof(); if (error.status === 403) onDenied(); else setState(old => ({ ...old, pending: false, result: null, error: error.message || 'Current saved consultation link could not be reviewed. No earlier result was confirmed.' })); };
  const review = async () => {
    if (!enabled || state.pending || !state.candidate) return;
    cancelProof(); const controller = begin();
    try {
      const source = await consultationApi.context(scope, null, { signal: controller.signal });
      const checked = source;
      if (!valid(controller)) return;
      if (checked.context_token !== current.context_token || checked.link_version !== current.link_version) throw new Error('The consultation context changed. Refresh the current referral, then review the saved consultation link again.');
      const next = await consultationManualReview('prepare', { scope, context: checked });
      if (!valid(controller)) { void consultationManualReview('cancel', { proof: next }); return; }
      proof.current = next; setState({ candidate: true, pending: false, result: { context: checked }, error: null });
    } catch (error) { fail(controller, error); }
    finally { if (operation.current === controller) operation.current = null; }
  };
  const acknowledge = async () => {
    if (!enabled || state.pending || !state.result || !proof.current) return;
    const original = proof.current; const controller = begin();
    try {
      const checked = await consultationApi.context(scope, null, { signal: controller.signal });
      if (!valid(controller)) return;
      await consultationManualReview('acknowledge', { scope, context: checked, proof: original });
      proof.current = null;
      if (!valid(controller)) return;
      setState(empty()); void onRefresh();
    } catch (error) { fail(controller, error); }
    finally { if (operation.current === controller) operation.current = null; }
  };
  return { ...state, review, acknowledge };
}
