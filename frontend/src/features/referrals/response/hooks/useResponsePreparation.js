import { useLayoutEffect, useRef, useState } from 'react';
import { useScopedNotifications } from '@/shared/hooks/useScopedNotifications';
import { hashQueryValue } from '@/shared/lib/privateQueryKey';
import { responseCommand } from '../model';
export function useResponsePreparation({ open, scope, access, source, notes, recommendations, reason, setReview, refresh, controller, onDenied }) {
  const [preparing, setPreparing] = useState(false); const [error, setError] = useState(null); const preparation = useRef(null);
  const capture = useScopedNotifications(hashQueryValue(JSON.stringify([access.scope, scope.patientId, scope.referralId])));
  useLayoutEffect(() => { if (!open) { preparation.current?.abort(); preparation.current = null; setPreparing(false); } return () => preparation.current?.abort(); }, [open]);
  const locked = preparing || controller.busy;
  const prepare = async operation => {
    if (locked || controller.unknown || !access.canWrite) return;
    const gate = new AbortController(); preparation.current?.abort(); preparation.current = gate; const lease = capture();
    setPreparing(true); setError(null);
    try {
      const refreshed = await refresh();
      if (gate.signal.aborted || !lease.isCurrent()) return;
      if (refreshed.error) throw refreshed.error;
      const fresh = refreshed.data;
      if (!fresh || fresh.context_token !== source.context_token || fresh.version !== source.version) throw new Error('The referral changed. Your text is kept. Review the latest saved response before preparing another change.');
      setReview(responseCommand({ scope, source: fresh, operation, specialistNotes: notes, recommendations, amendmentReason: operation === 'amend' ? reason : '', requestId: crypto.randomUUID(), actorId: access.user.id }));
    } catch (failure) { if (!gate.signal.aborted && lease.isCurrent()) { if (failure.status === 403) onDenied(); else setError(failure.message || 'The current referral could not be confirmed. Your draft is kept.'); } }
    finally { if (preparation.current === gate) { preparation.current = null; setPreparing(false); } }
  };
  return { preparing, error, setError, locked, prepare };
}
