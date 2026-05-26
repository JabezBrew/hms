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
    <>
      <tr
        className={cn(
          'group cursor-pointer border-b border-border transition-colors last:border-b-0',
          isCritical ? 'bg-rose-50/30 dark:bg-rose-950/10' : 'bg-card hover:bg-muted/20'
        )}
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <td className="px-3 py-3 align-middle">
          <div className="flex flex-col">
            <span className="font-mono text-[9px] uppercase leading-none text-muted-foreground">Bed</span>
            <span className="font-mono text-sm font-medium leading-tight text-foreground">{bed ?? '—'}</span>
          </div>
        </td>

        <td className="px-3 py-3 align-middle">
          <div className="min-w-0">
            <p className="truncate font-display text-base leading-tight text-foreground">{name}</p>
            <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
              {[mrn, age != null ? `${age} Y` : null, sex].filter(Boolean).join(' · ')}
            </p>
          </div>
        </td>

        <td className="px-3 py-3 align-middle">
          <Badge variant="outline" className={cn('font-mono text-[10px] capitalize', urgencyClassName)}>
            {urgency}
          </Badge>
        </td>

        <td className="px-3 py-3 align-middle">
          <p className="truncate text-xs text-foreground">
            {problems ?? <span className="text-muted-foreground">—</span>}
          </p>
        </td>

        <td className="px-3 py-3 align-middle">
          <ResultCell patient={patient} />
        </td>

        <td className="px-3 py-3 align-middle">
          {(patient?.reviews_due_count ?? 0) > 0 ? (
            <Badge variant="outline" className="border-amber-200 bg-amber-50 font-mono text-[10px] text-amber-700">
              Due soon
            </Badge>
          ) : (
            <span className="font-mono text-[11px] text-muted-foreground">—</span>
          )}
        </td>

        <td className="px-3 py-3 align-middle">
          <TaskCell patient={patient} />
        </td>

        <td className="px-3 py-3 align-middle">
          <DischargeCell patient={patient} />
        </td>

        <td className="px-3 py-3 align-middle">
          <p className="truncate font-mono text-[11px] text-foreground">{owner ?? '—'}</p>
        </td>

        <td className="px-3 py-3 align-middle">
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
              <ExternalLink className="h-3 w-3 text-muted-foreground hover:text-amber-700" />
            </Link>
            <ChevronDown
              className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-150', expanded && 'rotate-180')}
              aria-hidden="true"
            />
          </div>
        </td>
      </tr>

      {expanded ? (
        <tr>
          <td colSpan={10} className="p-0">
            <ExpandedPatientDetailPanel
              patient={patient}
              onTaskAction={onTaskAction}
              pendingAction={pendingAction}
            />
          </td>
        </tr>
      ) : null}
    </>
  );
}

export function PatientTable({ children }) {
  return (
    <table className="w-full min-w-[900px] border-collapse text-left">
      <colgroup>
        <col className="w-16" />
        <col className="w-48" />
        <col className="w-24" />
        <col className="w-48" />
        <col className="w-32" />
        <col className="w-24" />
        <col className="w-24" />
        <col className="w-28" />
        <col className="w-36" />
        <col />
      </colgroup>
      <thead className="sticky top-0 z-10">
        <tr className="border-b border-border bg-muted/80 backdrop-blur-sm">
          {['Bed', 'Patient', 'Risk', 'Active Problems', 'Pending Results', 'Reviews', 'Tasks', 'Discharge', 'Owner', 'Updated'].map((col) => (
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
