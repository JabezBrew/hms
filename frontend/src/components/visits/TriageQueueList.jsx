import Clock from 'lucide-react/dist/esm/icons/clock.js';
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import User from 'lucide-react/dist/esm/icons/user.js';
import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import formatDistanceToNow from 'date-fns/formatDistanceToNow';
import { ActionCard } from '@/components/dashboard';
import { useTriageQueue } from '@/hooks/useVisitQueries';
import { Skeleton } from '@/components/ui/skeleton';

const DEFAULT_EMPTY_OBJECT = {};

/**
 * Priority to color mapping
 */
const PRIORITY_CONFIG = {
  emergency: {
    color: 'rose',
    bgClass: 'bg-rose-500/10',
    textClass: 'text-rose-400',
    indicator: 'bg-rose-500',
  },
  urgent: {
    color: 'amber',
    bgClass: 'bg-amber-500/10',
    textClass: 'text-amber-400',
    indicator: 'bg-amber-500',
  },
  routine: {
    color: 'sky',
    bgClass: 'bg-muted/50',
    textClass: 'text-muted-foreground',
    indicator: 'bg-muted-foreground',
  },
};

/**
 * TriageQueueList - Displays triage queue entries grouped by status
 *
 * @param {Object} props
 * @param {Object} props.filters - Query filters (status, priority)
 * @param {Function} props.onTriage - Callback when triage action clicked
 * @param {Function} props.onAssign - Callback when assign action clicked
 * @param {Function} props.onCancel - Callback when cancel action clicked
 * @param {Function} props.onPatientClick - Callback when patient name clicked
 */
export function TriageQueueList({
  filters = DEFAULT_EMPTY_OBJECT,
  onTriage,
  onAssign,
  onCancel,
  onPatientClick,
}) {
  const navigate = useNavigate();
  const { data, isLoading, error } = useTriageQueue(filters);

  // Group entries by status
  const { waiting, triaged } = useMemo(() => {
    if (!data?.results) return { waiting: [], triaged: [] };

    const entries = data.results || data;
    return {
      waiting: entries.filter((e) => e.status === 'waiting'),
      triaged: entries.filter((e) => e.status === 'triaged'),
    };
  }, [data]);

  const handlePatientClick = (entry) => {
    if (onPatientClick) {
      onPatientClick(entry);
    } else {
      navigate(`/patients/${entry.patient}`);
    }
  };

  const getPriorityConfig = (priority) => {
    return PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.routine;
  };

  const getActions = (entry) => {
    const actions = [];

    if (entry.status === 'waiting') {
      actions.push({
        label: 'Triage',
        variant: 'default',
        onClick: () => onTriage?.(entry),
      });
    }

    if (entry.status === 'triaged') {
      actions.push({
        label: 'Assign to Clinic',
        variant: 'default',
        onClick: () => onAssign?.(entry),
      });
    }

    if (entry.status !== 'assigned' && entry.status !== 'cancelled') {
      actions.push({
        label: 'Cancel',
        variant: 'outline',
        onClick: () => onCancel?.(entry),
      });
    }

    return actions;
  };

  const renderEntry = (entry) => {
    const priorityConfig = getPriorityConfig(entry.priority);

    return (
      <ActionCard
        key={entry.id}
        title={
          <div className="flex items-center gap-2">
            <span
              className={`size-2 rounded-full ${priorityConfig.indicator}`}
            />
            <button
              type="button"
              className="cursor-pointer bg-transparent p-0 text-left hover:underline"
              onClick={() => handlePatientClick(entry)}
            >
              {entry.patient_name}
            </button>
          </div>
        }
        subtitle={entry.chief_complaint || 'No chief complaint provided'}
        status={entry.priority === 'emergency' ? 'critical' : entry.priority === 'urgent' ? 'warning' : 'info'}
        badges={[
          {
            text: entry.priority.charAt(0).toUpperCase() + entry.priority.slice(1),
            color: priorityConfig.color,
          },
          entry.assigned_clinic && {
            text: entry.assigned_clinic.name || 'Assigned',
            color: 'emerald',
          },
        ].filter(Boolean)}
        metadata={[
          {
            label: 'Arrived',
            value: formatDistanceToNow(new Date(entry.created_at), { addSuffix: true }),
            icon: Clock,
          },
          entry.triage_notes && {
            label: 'Notes',
            value: entry.triage_notes.substring(0, 50) + (entry.triage_notes.length > 50 ? '...' : ''),
            icon: AlertCircle,
          },
        ].filter(Boolean)}
        actions={getActions(entry)}
      />
    );
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
        <p className="text-sm text-rose-400">Failed to load triage queue: {error.message}</p>
      </div>
    );
  }

  const total = waiting.length + triaged.length;

  if (total === 0) {
    return (
      <div className="text-center py-12 rounded-xl border border-border bg-card/50">
        <User className="size-12 text-muted-foreground mx-auto mb-3" />
        <p className="text-muted-foreground">No patients in triage queue</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Waiting for Triage */}
      {waiting.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-heading text-sm font-semibold text-rose-400 uppercase tracking-wide">
            Waiting for Triage ({waiting.length})
          </h3>
          <div className="space-y-3">
            {waiting.map(renderEntry)}
          </div>
        </div>
      )}

      {/* Triaged - Pending Assignment */}
      {triaged.length > 0 && (
        <div className="space-y-3">
          <h3 className="font-heading text-sm font-semibold text-amber-400 uppercase tracking-wide">
            Triaged - Pending Assignment ({triaged.length})
          </h3>
          <div className="space-y-3">
            {triaged.map(renderEntry)}
          </div>
        </div>
      )}
    </div>
  );
}

