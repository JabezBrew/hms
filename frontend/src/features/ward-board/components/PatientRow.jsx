import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import ExternalLink from 'lucide-react/dist/esm/icons/external-link.js';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  formatTime,
  formatTimestamp,
  getPatientBed,
  getPatientDischargeCount,
  getPatientDueMedicationCount,
  getPatientMrn,
  getPatientName,
  getPatientOverdueTaskCount,
  getPatientPendingLabOrderCount,
  getPatientResultCount,
  getPatientStatus,
  getPatientTaskCount,
  getPatientUrgency,
  getPatientWardName,
  patientChronicleHref,
} from './wardBoardUtils';

const DISCHARGE_STATUS_STYLES = {
  requested: 'border-amber-200 bg-amber-50 text-amber-700',
  completed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  cancelled: 'border-border bg-muted text-muted-foreground',
};

function SafetyCell({ patient }) {
  const active = Number(patient?.active_alert_count ?? 0);
  const critical = Number(patient?.critical_alert_count ?? 0);
  if (active === 0 && critical === 0) {
    return <span className="font-mono text-[11px] text-muted-foreground">-</span>;
  }
  return (
    <div className="space-y-0.5">
      {critical > 0 ? (
        <Badge variant="outline" className="border-rose-200 bg-rose-50 font-mono text-[10px] text-rose-700">
          {critical} critical
        </Badge>
      ) : null}
      {active > critical ? (
        <p className="font-mono text-[10px] text-amber-600">{active - critical} active</p>
      ) : null}
    </div>
  );
}

function DischargeCell({ patient }) {
  const count = getPatientDischargeCount(patient);
  const status = String(patient?.discharge_status ?? '').toLowerCase();

  if (!status && count === 0) {
    return <span className="font-mono text-[11px] text-muted-foreground">-</span>;
  }

  const styleClass = DISCHARGE_STATUS_STYLES[status] ?? 'border-border bg-muted text-foreground';
  return (
    <div className="space-y-0.5">
      <Badge variant="outline" className={cn('font-mono text-[10px] capitalize', styleClass)}>
        {status || 'pending'}
      </Badge>
      {count > 0 ? (
        <p className="font-mono text-[10px] text-muted-foreground">{count} {count === 1 ? 'blocker' : 'blockers'}</p>
      ) : null}
    </div>
  );
}

function TaskCell({ patient }) {
  const total = getPatientTaskCount(patient);
  const overdue = getPatientOverdueTaskCount(patient);
  return (
    <div>
      <span className="font-mono text-sm text-foreground">{total}</span>
      {Number(overdue) > 0 ? (
        <p className="font-mono text-[11px] text-rose-600">{overdue} overdue</p>
      ) : patient?.next_nursing_task_due_at ? (
        <p className="font-mono text-[11px] text-muted-foreground">{formatTime(patient.next_nursing_task_due_at)}</p>
      ) : null}
    </div>
  );
}

function MedicationCell({ patient }) {
  const due = getPatientDueMedicationCount(patient);
  if (due === 0) {
    return <span className="font-mono text-[11px] text-muted-foreground">-</span>;
  }
  return (
    <div>
      <span className="font-mono text-sm text-foreground">{due}</span>
      {patient?.next_due_medication_at ? (
        <p className="font-mono text-[11px] text-amber-600">{formatTime(patient.next_due_medication_at)}</p>
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
  const critical = Number(patient?.critical_unverified_result_count ?? 0);
  const pendingOrders = getPatientPendingLabOrderCount(patient);
  if (count === 0 && pendingOrders === 0) {
    return <span className="font-mono text-[11px] text-muted-foreground">-</span>;
  }
  return (
    <div className="space-y-0.5">
      {count > 0 ? (
        <Badge
          variant="outline"
          className={cn(
            'font-mono text-[10px]',
            critical > 0
              ? 'border-rose-200 bg-rose-50 text-rose-700'
              : 'border-sky-200 bg-sky-50 text-sky-700'
          )}
        >
          {critical > 0 ? `${critical} critical` : `${count} review`}
        </Badge>
      ) : null}
      {pendingOrders > 0 ? (
        <p className="font-mono text-[10px] text-muted-foreground">{pendingOrders} ordered</p>
      ) : null}
    </div>
  );
}

export function PatientRow({ patient, selected, onOpenDetail }) {
  const name = getPatientName(patient);
  const mrn = getPatientMrn(patient);
  const bed = getPatientBed(patient);
  const wardName = getPatientWardName(patient);
  const urgency = getPatientUrgency(patient);
  const lastEvent = patient?.last_event_at ?? patient?.updated_at ?? patient?.last_updated;
  const lastObs = patient?.last_vitals_recorded_at ?? patient?.last_obs_at;
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
            {mrn}
          </p>
        </div>
      </td>

      <td className="p-3 align-middle">
        <StatusCell patient={patient} />
      </td>

      <td className="p-3 align-middle">
        <SafetyCell patient={patient} />
      </td>

      <td className="p-3 align-middle">
        <TaskCell patient={patient} />
      </td>

      <td className="p-3 align-middle">
        <MedicationCell patient={patient} />
      </td>

      <td className="p-3 align-middle">
        <ResultCell patient={patient} />
      </td>

      <td className="p-3 align-middle">
        <DischargeCell patient={patient} />
      </td>

      <td className="p-3 align-middle">
        <span className={cn('font-mono text-[11px]', lastObs ? 'text-foreground' : 'text-muted-foreground')}>
          {lastObs ? formatTimestamp(lastObs) : '—'}
        </span>
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
    <table className="w-full min-w-[1080px] border-collapse text-left">
      <colgroup>
        <col className="w-20" />
        <col className="w-56" />
        <col className="w-28" />
        <col className="w-28" />
        <col className="w-24" />
        <col className="w-24" />
        <col className="w-32" />
        <col className="w-28" />
        <col className="w-36" />
        <col />
      </colgroup>
      <thead className="sticky top-0 z-10">
        <tr className="border-b border-border bg-muted/80 backdrop-blur-sm">
          {['Bed', 'Patient', 'Status', 'Safety', 'Tasks', 'Meds', 'Results', 'Discharge', 'Last Obs', 'Updated'].map((col) => (
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
