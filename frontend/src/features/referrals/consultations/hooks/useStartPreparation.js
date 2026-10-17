import { useLayoutEffect, useRef, useState } from 'react';
import { useScopedNotifications } from '@/shared/hooks/useScopedNotifications';
import { hashQueryValue } from '@/shared/lib/privateQueryKey';
import { consultationApi } from '../api';
import { consultationCommand } from '../model';
export function useStartPreparation({ scope, access, source, current, baseContextToken, override, controller, onDenied }) {
  const [review, setReview] = useState(null), [preparing, setPreparing] = useState(false), [error, setError] = useState(null), active = useRef(false);
  const binding = hashQueryValue(JSON.stringify([scope, access.scope, source, baseContextToken, current?.context_token, override, access.canWrite, current?.can_start]));
  const capture = useScopedNotifications(binding);
  useLayoutEffect(() => { if (!controller.busy && !controller.unknown) setReview(null); }, [binding, controller.busy, controller.unknown]);
  const prepare = async () => {
    if (active.current || !source || !current?.can_start || !access.canWrite || controller.locked) return;
    const lease = capture(); active.current = true; setPreparing(true); setError(null); controller.reset();
    try {
      const fresh = await consultationApi.context(scope, source);
      if (!lease.isCurrent()) return;
      if (fresh.context_token !== current.context_token) throw new Error('The referral or selected source changed. Refresh and review the current source again.');
      const command = await consultationCommand({ scope, source: fresh, selection: source, override, requestId: crypto.randomUUID(), actorId: access.user.id });
      if (lease.isCurrent()) setReview(command);
    } catch (failure) { if (lease.isCurrent()) { if (failure.status === 403) onDenied(); else setError(failure.message); } }
    finally { active.current = false; setPreparing(false); }
  };
  return { review, setReview, preparing, error, prepare };
}
