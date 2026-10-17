import { useLayoutEffect, useState } from 'react';
import { hashQueryValue } from '@/shared/lib/privateQueryKey';
import { useScopedNotifications } from '@/shared/hooks/useScopedNotifications';

export function useLinkedConsultationNote({ query, current, accessScope, locked, onDenied, enabled = true }) {
  const [encounter, setEncounter] = useState(null), [open, setOpen] = useState(false), [error, setError] = useState(null), [opening, setOpening] = useState(false);
  const noteScope = hashQueryValue(JSON.stringify([accessScope, enabled, current?.can_resume, current?.link?.id, current?.link?.encounter_id, current?.current_linked_encounter?.status]));
  const capture = useScopedNotifications(noteScope);
  useLayoutEffect(() => { setEncounter(null); setOpen(false); setError(null); setOpening(false); }, [noteScope]);
  const linked = Boolean(enabled && current?.can_resume && current.current_linked_encounter?.status === 'in_progress' && current.current_linked_encounter.id === current.link?.encounter_id && encounter?.id === current.link.encounter_id);
  const begin = async () => {
    if (!enabled || opening || locked || !current?.can_resume) return;
    const lease = capture(); setOpening(true); setError(null);
    try {
      const fresh = await query.refetch();
      if (!lease.isCurrent()) return;
      if (fresh.error) throw fresh.error;
      if (!fresh.data?.can_resume || fresh.data.current_linked_encounter?.status !== 'in_progress' || fresh.data.current_linked_encounter.id !== current.link.encounter_id) throw new Error('The exact linked encounter is no longer available for new notes.');
      setEncounter(fresh.data.current_linked_encounter); setOpen(true);
    } catch (failure) {
      if (lease.isCurrent()) {
        if (failure.status === 403) onDenied();
        else setError(failure.message || 'Current linked encounter could not be confirmed.');
      }
    } finally { if (lease.isCurrent()) setOpening(false); }
  };
  return { linked, open, error, opening, begin, close: () => setOpen(false) };
}
