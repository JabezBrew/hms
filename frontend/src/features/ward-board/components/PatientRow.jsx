import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import ExternalLink from 'lucide-react/dist/esm/icons/external-link.js';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  URGENCY_STYLES,
  formatTimestamp,
  getPatientAge,
  getPatientBed,
  getPatientDischargeCount,
  getPatientMrn,
  getPatientName,
  getPatientNextAction,
  getPatientOwner,
  getPatientProblems,
  getPatientResultCount,
  getPatientSex,
  getPatientStatus,
  getPatientTaskCount,
  getPatientUrgency,
  getPatientWardName,
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
    return <span className="font-mono text-[11px] text-muted-foreground">-</span>;
  }

  const styleClass = DISCHARGE_STATUS_STYLES[status] ?? 'border-border bg-muted text-foreground';
  return (
    <div className="space-y-0.5">
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

function StatusCell({ patient }) {
  const status = getPatientStatus(patient);
  const normalized = String(status).toLowerCase();
  const className = normalized.includes('discharge')
    ? 'border-amber-200 bg-amber-50 text-amber-700'
    : 'border-emerald-200 bg-emerald-50 text-emerald-700';

  return (
    <Badge variant="outline" className={cn('font-mono text-[10px] capitalize', className)}>
      {status}
    </Badge>
  );
}

function ResultCell({ patient }) {
  const count = getPatientResultCount(patient);
  const due = patient?.reviews_due_count ?? 0;
  if (count === 0 && due === 0) {
    return <span className="font-mono text-[11px] text-muted-foreground">-</span>;
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

function NextActionCell({ patient }) {
  const nextAction = getPatientNextAction(patient);
  const toneClassName = URGENCY_STYLES[nextAction.tone] ?? URGENCY_STYLES.stable;
  return (
    <div className="min-w-0">
      <p className="truncate text-xs font-medium text-foreground">{nextAction.label}</p>
      <div className="mt-1 flex items-center gap-1.5">
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full border', toneClassName)} aria-hidden="true" />
        <span className="truncate font-mono text-[10px] text-muted-foreground">
          {nextAction.meta || 'Next routine check'}
        </span>
      </div>
    </div>
  );
}

export function PatientRow({ patient, selected, onOpenDetail }) {
  const name = getPatientName(patient);
  const mrn = getPatientMrn(patient);
  const bed = getPatientBed(patient);
  const wardName = getPatientWardName(patient);
  const urgency = getPatientUrgency(patient);
  const age = getPatientAge(patient);
  const sex = getPatientSex(patient);
  const problems = getPatientProblems(patient);
  const owner = getPatientOwner(patient);
  const lastEvent = patient?.last_event_at ?? patient?.updated_at ?? patient?.last_updated;
  const urgencyClassName = URGENCY_STYLES[urgency] ?? URGENCY_STYLES.stable;
  const isCritical = ['critical', 'urgent', 'high'].includes(urgency);
  const handleKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpenDetail?.();
    }
  };

  return (
    <tr
      className={cn(
        'group cursor-pointer border-b border-border transition-colors last:border-b-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500',
        selected && 'bg-amber-50/50 dark:bg-amber-950/10',
        isCritical ? 'bg-rose-50/30 dark:bg-rose-950/10' : 'bg-card hover:bg-muted/20'
      )}
      onClick={onOpenDetail}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      aria-label={`Open ward-board details for ${name}`}
    >
      <td className="p-3 align-middle">
        <div className="flex flex-col">
          <span className="font-mono text-[9px] uppercase leading-none text-muted-foreground">Bed</span>
          <span className="font-mono text-sm font-medium leading-tight text-foreground">{bed ?? '—'}</span>
          {wardName ? (
            <span className="mt-1 max-w-20 truncate font-mono text-[9px] text-muted-foreground">{wardName}</span>
          ) : null}
        </div>
      </td>

      <td className="p-3 align-middle">
        <div className="min-w-0">
          <p className="truncate font-display text-base leading-tight text-foreground">{name}</p>
          <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
            {[mrn, age != null ? `${age} Y` : null, sex].filter(Boolean).join(' · ')}
          </p>
          {problems ? (
            <p className="mt-1 truncate text-[11px] text-muted-foreground">{problems}</p>
          ) : null}
        </div>
      </td>

      <td className="p-3 align-middle">
        <StatusCell patient={patient} />
      </td>

      <td className="p-3 align-middle">
        <Badge variant="outline" className={cn('font-mono text-[10px] capitalize', urgencyClassName)}>
          {urgency}
        </Badge>
      </td>

      <td className="p-3 align-middle">
        <NextActionCell patient={patient} />
      </td>

      <td className="p-3 align-middle">
        <ResultCell patient={patient} />
      </td>

      <td className="p-3 align-middle">
        <TaskCell patient={patient} />
      </td>

      <td className="p-3 align-middle">
        <DischargeCell patient={patient} />
      </td>

      <td className="p-3 align-middle">
        <p className="truncate font-mono text-[11px] text-foreground">{owner ?? '—'}</p>
      </td>

      <td className="p-3 align-middle">
        <div className="flex items-center justify-between gap-1">
          <span className="font-mono text-[11px] text-muted-foreground">
            {lastEvent ? formatTimestamp(lastEvent) : '—'}
          </span>
          <Link
            to={patientChronicleHref(patient)}
            onClick={(e) => e.stopPropagation()}
            className="ml-1 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
            tabIndex={-1}
            aria-label={`Open Chronicle for ${name}`}
          >
            <ExternalLink className="size-3 text-muted-foreground hover:text-amber-700" />
          </Link>
          <ChevronRight
            className={cn('size-4 shrink-0 text-muted-foreground transition-transform duration-150', selected && 'text-amber-600')}
            aria-hidden="true"
          />
        </div>
      </td>
    </tr>
  );
}

export function PatientTable({ children }) {
  return (
    <table className="w-full min-w-[1040px] border-collapse text-left">
      <colgroup>
        <col className="w-20" />
        <col className="w-56" />
        <col className="w-28" />
        <col className="w-24" />
        <col className="w-56" />
        <col className="w-32" />
        <col className="w-24" />
        <col className="w-28" />
        <col className="w-36" />
        <col />
      </colgroup>
      <thead className="sticky top-0 z-10">
        <tr className="border-b border-border bg-muted/80 backdrop-blur-sm">
          {['Bed', 'Patient', 'Status', 'Risk', 'Next due', 'Results', 'Tasks', 'Discharge', 'Owner', 'Updated'].map((col) => (
            <th
              key={col}
              scope="col"
              className="px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
            >
              {col}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {children}
      </tbody>
    </table>
  );
}
