import Bed from 'lucide-react/dist/esm/icons/bed.js';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js';
import ExternalLink from 'lucide-react/dist/esm/icons/external-link.js';
import FileCheck2 from 'lucide-react/dist/esm/icons/file-check-2.js';
import TestTube2 from 'lucide-react/dist/esm/icons/test-tube-diagonal.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ExpandedPatientDetailPanel } from './ExpandedPatientDetailPanel';
import {
  URGENCY_STYLES,
  formatTimestamp,
  getPatientBed,
  getPatientDischargeCount,
  getPatientMrn,
  getPatientName,
  getPatientResultCount,
  getPatientTaskCount,
  getPatientUrgency,
  getWardLabel,
  patientChronicleHref,
} from './wardBoardUtils';

function CountPill({ icon: Icon, label, value, tone }) {
  return (
    <span className={cn('inline-flex h-8 items-center gap-1.5 rounded-md border px-2 font-mono text-[11px]', tone)}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      <span>{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

export function PatientRow({
  patient,
  expanded,
  onToggle,
  onTaskAction,
  pendingAction,
}) {
  const name = getPatientName(patient);
  const mrn = getPatientMrn(patient);
  const bed = getPatientBed(patient);
  const ward = getWardLabel(patient);
  const urgency = getPatientUrgency(patient);
  const taskCount = getPatientTaskCount(patient);
  const resultCount = getPatientResultCount(patient);
  const dischargeCount = getPatientDischargeCount(patient);
  const urgencyClassName = URGENCY_STYLES[urgency] ?? URGENCY_STYLES.stable;
  const lastEvent = patient?.last_event_at ?? patient?.updated_at ?? patient?.last_updated;

  return (
    <article className="overflow-hidden rounded-lg border border-border bg-card/80 shadow-sm">
      <div className="grid gap-4 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1.6fr)_auto_auto] lg:items-center">
        <button type="button" onClick={onToggle} className="min-w-0 text-left">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2 className="min-w-0 truncate font-display text-xl text-foreground">{name}</h2>
            <Badge variant="outline" className={cn('font-mono text-[10px]', urgencyClassName)}>
              {urgency}
            </Badge>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground">
            {bed ? (
              <span className="inline-flex items-center gap-1">
                <Bed className="h-3.5 w-3.5" aria-hidden="true" />
                {bed}
              </span>
            ) : null}
            {mrn ? <span>{mrn}</span> : null}
            {ward ? <span>{ward}</span> : null}
            {lastEvent ? <span>{formatTimestamp(lastEvent)}</span> : null}
          </div>
        </button>

        <div className="flex flex-wrap items-center gap-2">
          <CountPill icon={ClipboardList} label="tasks" value={taskCount} tone="border-amber-200 bg-amber-50 text-amber-700" />
          <CountPill icon={TestTube2} label="results" value={resultCount} tone="border-sky-200 bg-sky-50 text-sky-700" />
          <CountPill icon={FileCheck2} label="discharge" value={dischargeCount} tone="border-emerald-200 bg-emerald-50 text-emerald-700" />
        </div>

        <div className="flex items-center gap-2 lg:justify-end">
          <Button asChild variant="ghost" size="sm" className="font-mono text-xs">
            <Link to={patientChronicleHref(patient)}>
              Chronicle
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={onToggle}
            aria-label={expanded ? `Collapse ${name}` : `Expand ${name}`}
          >
            <ChevronDown className={cn('h-4 w-4 transition-transform', expanded && 'rotate-180')} aria-hidden="true" />
          </Button>
        </div>
      </div>

      {expanded ? (
        <ExpandedPatientDetailPanel
          patient={patient}
          onTaskAction={onTaskAction}
          pendingAction={pendingAction}
        />
      ) : null}
    </article>
  );
}
