import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js';
import ExternalLink from 'lucide-react/dist/esm/icons/external-link.js';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { ExpandedPatientDetailPanel } from './ExpandedPatientDetailPanel';
import {
  URGENCY_STYLES,
  formatTimestamp,
  getPatientAge,
  getPatientBed,
  getPatientDischargeCount,
  getPatientMrn,
  getPatientName,
  getPatientOwner,
  getPatientProblems,
  getPatientResultCount,
  getPatientSex,
  getPatientTaskCount,
  getPatientUrgency,
  patientChronicleHref,
} from './wardBoardUtils';

const DISCHARGE_STATUS_STYLES = {
  blocked: 'border-rose-200 bg-rose-50 text-rose-700',
  possible: 'border-amber-200 bg-amber-50 text-amber-700',
  ready: 'border-emerald-200 bg-emerald-50 text-emerald-700',
};

function DischargeCell({ patient }) {
  const count = getPatientDischargeCount(patient);
  const status = String(patient?.discharge_status ?? '').toLowerCase();
  const blockerCount = patient?.discharge_blocker_count ?? patient?.discharge_blocker_reasons?.length ?? 0;

  if (status === 'none' || (!status && count === 0)) {
    return <span className="font-mono text-[11px] text-muted-foreground">—</span>;
  }

  const styleClass = DISCHARGE_STATUS_STYLES[status] ?? 'border-border bg-muted text-foreground';
  return (
    <div className="space-y-1">
      <Badge variant="outline" className={cn('font-mono text-[10px] capitalize', styleClass)}>
        {status || 'pending'}
      </Badge>
      {blockerCount > 0 ? (
        <p className="font-mono text-[10px] text-muted-foreground">{blockerCount} {blockerCount === 1 ? 'reason' : 'reasons'}</p>
      ) : null}
    </div>
  );
}

function TaskCell({ patient }) {
  const total = getPatientTaskCount(patient);
  const overdue = patient?.overdue_task_count ?? patient?.overdue_tasks ?? 0;
  return (
    <div>
      <span className="font-mono text-sm text-foreground">{total}</span>
      {Number(overdue) > 0 ? (
        <p className="font-mono text-[11px] text-rose-600">{overdue} overdue</p>
      ) : null}
    </div>
  );
}

function ResultCell({ patient }) {
  const count = getPatientResultCount(patient);
  const due = patient?.reviews_due_count ?? 0;
  if (count === 0 && due === 0) {
    return <span className="font-mono text-[11px] text-muted-foreground">—</span>;
  }
  return (
    <div className="space-y-0.5">
      {count > 0 ? (
        <Badge variant="outline" className="border-sky-200 bg-sky-50 font-mono text-[10px] text-sky-700">
          {count} pending
        </Badge>
      ) : null}
      {due > 0 ? (
        <p className="font-mono text-[10px] text-amber-600">Due soon</p>
      ) : null}
    </div>
  );
}

export function PatientRow({ patient, expanded, onToggle, onTaskAction, pendingAction }) {
  const name = getPatientName(patient);
  const mrn = getPatientMrn(patient);
  const bed = getPatientBed(patient);
  const urgency = getPatientUrgency(patient);
  const age = getPatientAge(patient);
  const sex = getPatientSex(patient);
  const problems = getPatientProblems(patient);
  const owner = getPatientOwner(patient);
  const lastEvent = patient?.last_event_at ?? patient?.updated_at ?? patient?.last_updated;
  const urgencyClassName = URGENCY_STYLES[urgency] ?? URGENCY_STYLES.stable;
  const isCritical = ['critical', 'urgent', 'high'].includes(urgency);

  return (
    <article
      className={cn(
        'group overflow-hidden border-b border-border last:border-b-0 transition-colors',
        isCritical ? 'bg-rose-50/30 dark:bg-rose-950/10' : 'bg-card hover:bg-muted/20'
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="grid w-full items-center gap-0 text-left"
        style={{
          gridTemplateColumns: 'auto minmax(0,1.8fr) 5.5rem minmax(0,1.2fr) 7rem 7rem 6rem 7rem minmax(0,1fr) 5rem 2.5rem',
        }}
        aria-expanded={expanded}
        aria-label={`${expanded ? 'Collapse' : 'Expand'} ${name}`}
      >
        <div className="flex w-16 shrink-0 flex-col items-start px-3 py-3">
          <span className="font-mono text-[9px] uppercase text-muted-foreground">Bed</span>
          <span className="font-mono text-sm font-medium text-foreground">{bed ?? '—'}</span>
        </div>

        <div className="min-w-0 px-2 py-3">
          <div className="flex min-w-0 items-baseline gap-2">
            <h2 className="min-w-0 truncate font-display text-base leading-tight text-foreground">{name}</h2>
          </div>
          <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
            {[mrn, age != null ? `${age} Y` : null, sex].filter(Boolean).join(' · ')}
          </p>
        </div>

        <div className="px-2 py-3">
          <Badge variant="outline" className={cn('font-mono text-[10px] capitalize', urgencyClassName)}>
            {urgency}
          </Badge>
        </div>

        <div className="min-w-0 px-2 py-3">
          <p className="truncate text-xs text-foreground">{problems || <span className="text-muted-foreground">—</span>}</p>
        </div>

        <div className="px-2 py-3">
          <ResultCell patient={patient} />
        </div>

        <div className="px-2 py-3">
          {(patient?.reviews_due_count ?? 0) > 0 ? (
            <Badge variant="outline" className="border-amber-200 bg-amber-50 font-mono text-[10px] text-amber-700">
              1 due soon
            </Badge>
          ) : (
            <span className="font-mono text-[11px] text-muted-foreground">—</span>
          )}
        </div>

        <div className="px-2 py-3">
          <TaskCell patient={patient} />
        </div>

        <div className="px-2 py-3">
          <DischargeCell patient={patient} />
        </div>

        <div className="min-w-0 px-2 py-3">
          <p className="truncate font-mono text-[11px] text-foreground">{owner ?? '—'}</p>
        </div>

        <div className="px-2 py-3">
          <span className="font-mono text-[11px] text-muted-foreground">
            {lastEvent ? formatTimestamp(lastEvent) : '—'}
          </span>
        </div>

        <div className="flex items-center justify-center px-2 py-3">
          <ChevronDown
            className={cn('h-4 w-4 text-muted-foreground transition-transform duration-150', expanded && 'rotate-180')}
            aria-hidden="true"
          />
        </div>
      </button>

      {expanded ? (
        <ExpandedPatientDetailPanel
          patient={patient}
          onTaskAction={onTaskAction}
          pendingAction={pendingAction}
        />
      ) : null}

      {!expanded ? (
        <div className="flex items-center justify-end border-t border-border/0 px-4 pb-0 pt-0 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true">
          <Link
            to={patientChronicleHref(patient)}
            onClick={(e) => e.stopPropagation()}
            className="flex h-6 items-center gap-1 rounded px-2 font-mono text-[10px] text-muted-foreground hover:text-amber-700"
            tabIndex={-1}
          >
            Chronicle <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      ) : null}
    </article>
  );
}

export function PatientTableHeader() {
  const cols = [
    { label: 'Bed', width: 'w-16 shrink-0' },
    { label: 'Patient', width: 'flex-1 min-w-0' },
    { label: 'Risk', width: 'w-[5.5rem] shrink-0' },
    { label: 'Active Problems', width: 'flex-1 min-w-0' },
    { label: 'Pending Results', width: 'w-28 shrink-0' },
    { label: 'Reviews', width: 'w-28 shrink-0' },
    { label: 'Tasks', width: 'w-24 shrink-0' },
    { label: 'Discharge', width: 'w-28 shrink-0' },
    { label: 'Owner', width: 'flex-1 min-w-0' },
    { label: 'Updated', width: 'w-20 shrink-0' },
    { label: '', width: 'w-10 shrink-0' },
  ];
  return (
    <div
      className="flex items-center border-b border-border bg-muted/40 px-0"
      role="row"
      aria-label="Patient table columns"
    >
      {cols.map((col) => (
        <div
          key={col.label}
          role="columnheader"
          className={cn('px-2 py-2 font-mono text-[10px] uppercase tracking-wide text-muted-foreground', col.width)}
        >
          {col.label}
        </div>
      ))}
    </div>
  );
}
