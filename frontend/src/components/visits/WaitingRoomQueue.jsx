import Clock from 'lucide-react/dist/esm/icons/clock.js';
import User from 'lucide-react/dist/esm/icons/user.js';
import Phone from 'lucide-react/dist/esm/icons/phone.js';
import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import formatDistanceToNow from 'date-fns/formatDistanceToNow';
import { ActionCard } from '@/components/dashboard';
import { VisitStatusBadge } from './VisitStatusBadge';
import { useWaitingRoom, useVisitActions } from '@/hooks/useVisitQueries';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * WaitingRoomQueue - Displays clinic waiting room with patient queue
 *
 * @param {Object} props
 * @param {string} props.clinicId - Clinic UUID to show queue for
 * @param {boolean} props.showActions - Show action buttons (default: true)
 * @param {Function} props.onPatientClick - Callback when patient name clicked
 */
export function WaitingRoomQueue({ clinicId, showActions = true, onPatientClick }) {
  const navigate = useNavigate();
  const { data: queue, isLoading, error } = useWaitingRoom(clinicId);
  const { callPatient, startConsultation, markNoShow } = useVisitActions();

  // Group queue by status
  const { waiting, called } = useMemo(() => {
    if (!queue) return { waiting: [], called: [] };

    return {
      waiting: queue.filter((v) => v.visit_status === 'waiting'),
      called: queue.filter((v) => v.visit_status === 'called'),
    };
  }, [queue]);

  const handlePatientClick = (visit) => {
    if (onPatientClick) {
      onPatientClick(visit);
    } else {
      // Default: navigate to patient chronicle
      navigate(`/patients/${visit.encounter_id}`);
    }
  };

  const getActions = (visit) => {
    if (!showActions) return [];

    if (visit.visit_status === 'waiting') {
      return [
        {
          label: 'Call Patient',
          variant: 'default',
          onClick: () => callPatient.mutate(visit.encounter_id),
          disabled: callPatient.isPending,
        },
        {
          label: 'No Show',
          variant: 'outline',
          onClick: () => markNoShow.mutate(visit.encounter_id),
          disabled: markNoShow.isPending,
        },
      ];
    }

    if (visit.visit_status === 'called') {
      return [
        {
          label: 'Start Consultation',
          variant: 'default',
          onClick: () => startConsultation.mutate(visit.encounter_id),
          disabled: startConsultation.isPending,
        },
        {
          label: 'No Show',
          variant: 'outline',
          onClick: () => markNoShow.mutate(visit.encounter_id),
          disabled: markNoShow.isPending,
        },
      ];
    }

    return [];
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4">
        <p className="text-sm text-rose-400">Failed to load waiting room: {error.message}</p>
      </div>
    );
  }

  if (queue?.length === 0) {
    return (
      <div className="text-center py-12 rounded-xl border border-border bg-card/50">
        <User className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
        <p className="text-muted-foreground">No patients in waiting room</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Called Section */}
      {called.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-heading text-sm font-semibold text-amber-400 uppercase tracking-wide">
            Called ({called.length})
          </h3>
          <div className="space-y-3">
            {called.map((visit) => (
              <ActionCard
                key={visit.encounter_id}
                title={
                  <span
                    className="cursor-pointer hover:underline"
                    onClick={() => handlePatientClick(visit)}
                  >
                    #{visit.queue_number} {visit.patient_name}
                  </span>
                }
                status="warning"
                badges={[
                  {
                    text: 'Called',
                    color: 'amber',
                  },
                  visit.called_at && {
                    text: formatDistanceToNow(new Date(visit.called_at), { addSuffix: true }),
                    color: 'sky',
                  },
                ].filter(Boolean)}
                metadata={[
                  {
                    label: 'Checked In',
                    value: formatDistanceToNow(new Date(visit.checked_in_at), { addSuffix: true }),
                    icon: Clock,
                  },
                ].filter(Boolean)}
                actions={getActions(visit)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Waiting Section */}
      {waiting.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-heading text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Waiting ({waiting.length})
          </h3>
          <div className="space-y-3">
            {waiting.map((visit) => (
              <ActionCard
                key={visit.encounter_id}
                title={
                  <span
                    className="cursor-pointer hover:underline"
                    onClick={() => handlePatientClick(visit)}
                  >
                    #{visit.queue_number} {visit.patient_name}
                  </span>
                }
                status="info"
                badges={[
                  {
                    text: 'Waiting',
                    color: 'sky',
                  },
                ]}
                metadata={[
                  {
                    label: 'Checked In',
                    value: formatDistanceToNow(new Date(visit.checked_in_at), { addSuffix: true }),
                    icon: Clock,
                  },
                ].filter(Boolean)}
                actions={getActions(visit)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default WaitingRoomQueue;
