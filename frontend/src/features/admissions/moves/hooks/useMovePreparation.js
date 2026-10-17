import { useLayoutEffect, useRef, useState } from 'react';
import { useScopedNotifications } from '@/shared/hooks/useScopedNotifications';
import { hashQueryValue } from '@/shared/lib/privateQueryKey';
import { moveCommand } from '../model';
async function prepareMove({ scope, access, current, refresh, controller, selected, reason, query, onDenied, setReview, capture, inFlight, setPreparing, setError }) {
  if (inFlight.current || controller.locked || !selected || !access.canWrite) return;
  const lease = capture(); inFlight.current = true; setPreparing(true); setError(null);
  controller.reset();
  try {
    const [fresh, destinations] = await Promise.all([refresh(), query.refetch()]);
    if (!lease.isCurrent()) return;
    if (fresh.error?.status === 403 || destinations.error?.status === 403) { onDenied(); return; }
    if (fresh.error || destinations.error || !fresh.data || !destinations.data) throw new Error('Current placement and destination could not be confirmed. Refresh before reviewing.');
    const candidate = destinations.data.rows.find(row => row.bed_id === selected.bed_id);
    if (fresh.data.placement_token !== current.placement_token || fresh.data.task_membership_token !== current.task_membership_token || !candidate || candidate.candidate_token !== selected.candidate_token) throw new Error('The placement, task routing or destination changed. Choose and review the current destination again.');
    setReview(moveCommand({ scope, source: fresh.data, destination: candidate, reason, requestId: crypto.randomUUID(), actorId: access.user.id }));
  } catch (failure) { if (lease.isCurrent()) setError(failure.message); }
  finally { inFlight.current = false; setPreparing(false); }
}
export function useMovePreparation(input) {
  const { scope, access, current, controller, selected, reason, review, setReview, query, onDenied } = input;
  const [preparing, setPreparing] = useState(false), [error, setError] = useState(null), inFlight = useRef(false);
  const denied = query.error?.status === 403;
  useLayoutEffect(() => { if (denied) onDenied(); }, [denied, onDenied]);
  const binding = hashQueryValue(JSON.stringify([scope, access.scope, current.placement_token, current.task_membership_token, selected, reason]));
  const capture = useScopedNotifications(binding);
  useLayoutEffect(() => { if (review && !controller.busy && (!access.canWrite || current.placement_token !== review.source.placement_token || current.task_membership_token !== review.source.task_membership_token || !current.can_move)) setReview(null); }, [review, current, access.canWrite, controller.busy, setReview]);
  return { preparing, error, prepare: () => prepareMove({ ...input, capture, inFlight, setPreparing, setError }) };
}
