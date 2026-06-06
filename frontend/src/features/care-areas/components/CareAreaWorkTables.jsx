import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right.js';
import ExternalLink from 'lucide-react/dist/esm/icons/external-link.js';
import { Link } from 'react-router-dom';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

const TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
});

const STATUS_STYLES = {
  waiting: 'border-amber-200 bg-amber-50 text-amber-700',
  called: 'border-sky-200 bg-sky-50 text-sky-700',
  in_triage: 'border-violet-200 bg-violet-50 text-violet-700',
  triaged: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  in_consultation: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  assigned: 'border-sky-200 bg-sky-50 text-sky-700',
  completed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  emergency: 'border-rose-200 bg-rose-50 text-rose-700',
  urgent: 'border-amber-200 bg-amber-50 text-amber-700',
  routine: 'border-border bg-muted text-muted-foreground',
};

function humanize(value, fallback = '-') {
  if (!value) return fallback;
  return String(value).replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : TIME_FORMATTER.format(date);
}

function waitingTime(value) {
  if (!value) return '-';
  const started = new Date(value).getTime();
  if (Number.isNaN(started)) return '-';
  const minutes = Math.max(0, Math.floor((Date.now() - started) / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function patientLabel(item) {
  return item?.patient_display_name || item?.patient_name || item?.display_name || 'Patient';
}

function patientCode(item) {
  return item?.patient_code || item?.patient_mrn || item?.patient_identifier || null;
}

function chronicleHrefForWorkItem(item, options = {}) {
  const patientId = item?.patient_id || item?.patient || item?.id;
  if (!patientId) return '/patients';
  const params = new URLSearchParams();
  const encounterId = options.encounterId || item?.encounter_id || item?.encounter;
  const admissionId = options.admissionId || item?.admission_id || item?.admission_case_id;
  if (encounterId) params.set('visit', String(encounterId));
  if (admissionId) params.set('admission', String(admissionId));
  const query = params.toString();
  return `/patients/${patientId}${query ? `?${query}` : ''}`;
}

export function CareAreaSection({ title, description, action, children, className }) {
  return (
    <section className={cn('rounded-lg border border-border bg-card', className)}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="font-heading text-base font-semibold text-foreground">{title}</h2>
          {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

export function WorkStatusBadge({ value }) {
  const normalized = String(value || '').toLowerCase();
  return (
    <Badge variant="outline" className={cn('font-mono text-[10px] capitalize', STATUS_STYLES[normalized])}>
      {humanize(value)}
    </Badge>
  );
}

export function OutpatientVisitTable({
  visits,
  clinicName,
  waitingRoomHref,
  emptyLabel = 'No patients in this clinic queue',
}) {
  if (!Array.isArray(visits) || visits.length === 0) {
    return <p className="px-4 py-8 text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {['Patient', 'Clinic', 'Visit State', 'Checked In', 'Triage', 'Clinician', 'Next'].map((column) => (
            <TableHead key={column} className="font-mono text-[10px] uppercase text-muted-foreground">
              {column}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {visits.map((visit) => (
          <TableRow key={visit.id || visit.visit_id}>
            <TableCell>
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">{patientLabel(visit)}</p>
                {patientCode(visit) ? <p className="font-mono text-[10px] text-muted-foreground">{patientCode(visit)}</p> : null}
              </div>
            </TableCell>
            <TableCell>{clinicName || visit.clinic_name || visit.clinic_id || '-'}</TableCell>
            <TableCell><WorkStatusBadge value={visit.visit_status || visit.status} /></TableCell>
            <TableCell className="font-mono text-xs">{formatTime(visit.checked_in_at)}</TableCell>
            <TableCell>{humanize(visit.triage_status, 'Not recorded')}</TableCell>
            <TableCell>{visit.practitioner_name || visit.clinician_name || 'Not assigned'}</TableCell>
            <TableCell>
              <div className="flex items-center gap-2">
                <Button asChild size="sm" variant="outline" className="font-mono text-xs">
                  <Link to={chronicleHrefForWorkItem(visit)}>
                    Chronicle
                    <ExternalLink className="ml-2 size-3.5" aria-hidden="true" />
                  </Link>
                </Button>
                {waitingRoomHref ? (
                  <Button asChild size="sm" variant="ghost" className="font-mono text-xs">
                    <Link to={waitingRoomHref}>Room</Link>
                  </Button>
                ) : null}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function EmergencyQueueTable({ entries, emptyLabel = 'No emergency queue patients' }) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return <p className="px-4 py-8 text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {['Patient', 'Acuity', 'State', 'Waiting', 'Assigned', 'Location', 'Disposition', 'Next'].map((column) => (
            <TableHead key={column} className="font-mono text-[10px] uppercase text-muted-foreground">
              {column}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow key={entry.id}>
            <TableCell>
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">{patientLabel(entry)}</p>
                {patientCode(entry) ? <p className="font-mono text-[10px] text-muted-foreground">{patientCode(entry)}</p> : null}
              </div>
            </TableCell>
            <TableCell><WorkStatusBadge value={entry.acuity || entry.priority} /></TableCell>
            <TableCell><WorkStatusBadge value={entry.status} /></TableCell>
            <TableCell className="font-mono text-xs">{waitingTime(entry.created_at)}</TableCell>
            <TableCell>{entry.assigned_to_name || entry.assigned_to_display || 'Unassigned'}</TableCell>
            <TableCell>{entry.location || 'Emergency'}</TableCell>
            <TableCell>{humanize(entry.disposition, 'Pending')}</TableCell>
            <TableCell>
              <Button asChild size="sm" variant="outline" className="font-mono text-xs">
                <Link to={chronicleHrefForWorkItem(entry, { encounterId: entry.encounter_id || entry.visit_encounter_id })}>
                  Chronicle
                  <ArrowRight className="ml-2 size-3.5" aria-hidden="true" />
                </Link>
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function MyWorkPreviewList({ items, type }) {
  if (!Array.isArray(items) || items.length === 0) {
    return <p className="px-4 py-4 text-sm text-muted-foreground">No current items</p>;
  }

  return (
    <div className="divide-y divide-border">
      {items.map((item) => {
        const href = type === 'ward'
          ? `/wards/${item.ward_id}/board`
          : chronicleHrefForWorkItem(item);
        const title = type === 'ward' ? item.ward_name : patientLabel(item);
        const meta = type === 'ward'
          ? [item.role_name, item.is_primary ? 'Primary' : null].filter(Boolean).join(' / ')
          : [patientCode(item), item.context_kind ? humanize(item.context_kind) : null].filter(Boolean).join(' / ');
        return (
          <Link key={item.assignment_id || item.id || title} to={href} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40">
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-foreground">{title}</span>
              {meta ? <span className="block truncate font-mono text-[10px] text-muted-foreground">{meta}</span> : null}
            </span>
            <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </Link>
        );
      })}
    </div>
  );
}
