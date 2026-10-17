import { useLayoutEffect, useRef, useState } from 'react';
import { useScopedNotifications } from '@/shared/hooks/useScopedNotifications';
import { useCommandTransportLifetime } from '@/shared/hooks/useCommandTransportLifetime';

// A fresh protected read may complete after close, credential rotation or a
// scope change. Only the original live open cycle can turn it into a new form.
export function useCourseActionReview({ open, proof, context, detail, canStart, onBegin, onDenied }) {
  const [reviewing, setReviewing] = useState(false); const [error, setError] = useState(null);
  const operation = useRef(null); const visible = useRef(null); const capture = useScopedNotifications(proof);
  useCommandTransportLifetime(operation, () => { setReviewing(false); setError('Sign-in proof changed. Start a fresh admission and source review before changing this course.'); });
  useLayoutEffect(() => {
    const lease = { open }; visible.current = lease;
    if (!open && operation.current) { operation.current.abort(); operation.current = null; setReviewing(false); }
    return () => { lease.open = false; };
  }, [open]);
  useLayoutEffect(() => () => operation.current?.abort(), []);
  const start = async (kind) => {
    if (!canStart || operation.current) return;
    const origin = capture(); const view = visible.current;
    if (!origin.isCurrent() || !view?.open) return;
    const request = new AbortController(); operation.current = request; setReviewing(true); setError(null);
    const current = () => !request.signal.aborted && origin.isCurrent() && view.open && visible.current === view;
    try {
      const [freshContext, freshDetail] = await Promise.all([context.refetch({ throwOnError: true }), detail.refetch({ throwOnError: true })]);
      if (!current()) return;
      const permitted = kind === 'stop' ? freshDetail.data.can_stop_course : freshDetail.data.can_request_schedule_window;
      if (!freshContext.data.can_manage_courses || !permitted || freshContext.data.context_token !== freshDetail.data.context_token) throw new Error('The admission or course changed. Review the refreshed current details before starting this action.');
      onBegin({ kind, source: structuredClone(freshDetail.data), context: structuredClone(freshContext.data) });
    } catch (failure) {
      if (!current()) return;
      if (failure.status === 403) onDenied(); else setError(failure.message || 'Current review could not be confirmed.');
    } finally {
      if (operation.current === request) { operation.current = null; setReviewing(false); }
    }
  };
  return { start, reviewing, error };
}
