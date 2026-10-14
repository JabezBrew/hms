import Clock from 'lucide-react/dist/esm/icons/clock.js';
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import User from 'lucide-react/dist/esm/icons/user.js';
import { useNavigate } from 'react-router-dom';
import formatDistanceToNow from 'date-fns/formatDistanceToNow';
import { ActionCard } from '@/components/dashboard';
import { Skeleton } from '@/components/ui/skeleton';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { triagePatientPath } from '@/features/triage/utils/triagePatientPath';

const PRIORITY_CONFIG = {
  emergency: { color: 'rose', indicator: 'bg-rose-500' },
  urgent: { color: 'amber', indicator: 'bg-amber-500' },
  routine: { color: 'sky', indicator: 'bg-muted-foreground' },
};

function arrivalLabel(value) {
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime())
    ? formatDistanceToNow(date, { addSuffix: true })
    : 'Not recorded';
}

// The page owns the server query, filters and cursor pagination. This component
// renders every status in that page without running a second queue query.
export function TriageQueueList({ data, isLoading, onTriage, onAssign, onCancel, onPatientClick }) {
  const navigate = useNavigate();
  const isRustV2 = isRustV2ApiMode();
  const entries = Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : [];
  const groups = [
    { status: 'waiting', title: 'Waiting for assessment' },
    { status: 'assigned', title: 'Assigned for assessment' },
    { status: 'triaged', title: isRustV2 ? 'Assessment completed' : 'Triaged — pending clinic assignment' },
    { status: 'completed', title: 'Assessment completed' },
    { status: 'cancelled', title: 'Cancelled' },
  ];

  function actionsFor(entry) {
    const actions = [];
    if (entry.status === 'waiting' || (isRustV2 && entry.status === 'assigned')) {
      if (onTriage) actions.push({ label: 'Assess', variant: 'default', onClick: () => onTriage(entry) });
    }
    if (isRustV2 && ['waiting', 'assigned'].includes(entry.status)) {
      if (onAssign) actions.push({
        label: entry.status === 'assigned' ? 'Reassign staff' : 'Assign staff',
        variant: 'outline',
        onClick: () => onAssign(entry),
      });
    } else if (!isRustV2 && entry.status === 'triaged' && onAssign) {
      actions.push({ label: 'Assign to Clinic', variant: 'default', onClick: () => onAssign(entry) });
    }
    const canCancel = isRustV2 ? entry.status === 'waiting' : !['assigned', 'cancelled'].includes(entry.status);
    if (canCancel && onCancel) actions.push({ label: 'Cancel', variant: 'outline', onClick: () => onCancel(entry) });
    return actions;
  }

  function renderEntry(entry) {
    const priority = entry.priority || entry.acuity || 'routine';
    const config = PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.routine;
    return (
      <ActionCard
        key={entry.id}
        title={(
          <div className="flex items-center gap-2">
            <span className={`size-2 shrink-0 rounded-full ${config.indicator}`} aria-hidden="true" />
            <button
              type="button"
              className="min-w-0 truncate bg-transparent p-0 text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onPatientClick ? onPatientClick(entry) : navigate(triagePatientPath(entry))}
            >
              {entry.patient_name || entry.patient_display_name || 'Patient'}
            </button>
          </div>
        )}
        subtitle={entry.chief_complaint || undefined}
        status={priority === 'emergency' ? 'critical' : priority === 'urgent' ? 'warning' : 'info'}
        badges={[
          { text: priority.charAt(0).toUpperCase() + priority.slice(1), color: config.color },
          entry.assigned_to_name && { text: `Assigned: ${entry.assigned_to_name}`, color: 'emerald' },
          entry.assigned_clinic && { text: entry.assigned_clinic.name || 'Assigned', color: 'emerald' },
        ].filter(Boolean)}
        metadata={[
          { label: 'Arrived', value: arrivalLabel(entry.created_at), icon: Clock },
          entry.triage_notes && {
            label: 'Notes',
            value: entry.triage_notes.substring(0, 50) + (entry.triage_notes.length > 50 ? '...' : ''),
            icon: AlertCircle,
          },
        ].filter(Boolean)}
        actions={actionsFor(entry)}
      />
    );
  }

  if (isLoading) return (
    <div className="space-y-4" aria-label="Loading triage queue">
      {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-28" />)}
    </div>
  );

  if (!entries.length) return (
    <div className="rounded-xl border border-border bg-card/50 py-12 text-center">
      <User className="mx-auto mb-3 size-12 text-muted-foreground" aria-hidden="true" />
      <p className="text-muted-foreground">No triage entries match these filters</p>
    </div>
  );

  return (
    <div className="space-y-6">
      {groups.map(({ status, title }) => {
        const groupEntries = entries.filter((entry) => entry.status === status);
        return groupEntries.length ? (
          <section key={status} className="space-y-3" aria-label={title}>
            <h3 className="font-heading text-sm font-semibold text-foreground">{title} ({groupEntries.length})</h3>
            <div className="space-y-3">{groupEntries.map(renderEntry)}</div>
          </section>
        ) : null;
      })}
    </div>
  );
}
