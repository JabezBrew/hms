import X from 'lucide-react/dist/esm/icons/x.js';
import Pill from 'lucide-react/dist/esm/icons/pill.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import { useEffect, useMemo, useState } from 'react';
import format from 'date-fns/format';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { WorkspaceShell } from '@/components/chronicle/WorkspaceShell';
import { useMedicationAdministrationHistory } from '@/features/nursing/hooks';

const STATUS_BADGE_CLASS = {
  administered: 'bg-emerald-600 text-white',
  scheduled: 'border-slate-300 text-slate-700',
  missed: 'bg-rose-600 text-white',
  refused: 'bg-amber-600 text-white',
  held: 'bg-slate-700 text-white',
  cancelled: 'bg-slate-500 text-white',
};

function formatDateTime(value) {
  if (!value) return '—';
  try {
    return format(new Date(value), 'MMM d, yyyy h:mm a');
  } catch {
    return value;
  }
}

const MedicationHistorySlideOver = ({
  open,
  onClose,
  patient,
}) => {
  const patientId = patient?.local_data?.id || patient?.id;
  const patientName = patient?.local_data?.user_details
    ? `${patient.local_data.user_details.first_name || ''} ${patient.local_data.user_details.last_name || ''}`.trim()
    : patient?.name || 'Patient';

  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (!open) {
      setStatusFilter('all');
      setPage(1);
    }
  }, [open]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, patientId]);

  const { data, isLoading } = useMedicationAdministrationHistory(
    {
      patient: patientId,
      status: statusFilter,
      page,
      page_size: 20,
      ordering: '-scheduled_time',
    },
    {
      enabled: open,
    },
  );

  const records = useMemo(() => data?.results ?? [], [data]);

  return (
    <WorkspaceShell open={open}>
      <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-sky-100 dark:bg-sky-900/30">
            <Pill className="h-5 w-5 text-sky-600 dark:text-sky-400" />
          </div>
          <div>
            <h2 className="font-display text-xl text-foreground">Medication History</h2>
            <p className="font-mono text-xs text-muted-foreground mt-0.5">{patientName}</p>
          </div>
        </div>

        <Button
          variant="destructive"
          size="sm"
          onClick={onClose}
          className="font-mono text-xs bg-red-500 hover:bg-red-600 text-white"
        >
          <X className="h-4 w-4 mr-1.5" />
          Close
        </Button>
      </header>

      <div className="px-6 py-3 border-b border-border bg-muted/20">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
              Historical MAR
            </p>
            <p className="text-sm text-muted-foreground">
              Recent medication administration records across the patient&apos;s care history.
            </p>
          </div>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-[190px] font-mono">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all" className="font-mono">All statuses</SelectItem>
              <SelectItem value="administered" className="font-mono">Administered</SelectItem>
              <SelectItem value="scheduled" className="font-mono">Scheduled</SelectItem>
              <SelectItem value="missed" className="font-mono">Missed</SelectItem>
              <SelectItem value="refused" className="font-mono">Refused</SelectItem>
              <SelectItem value="held" className="font-mono">Held</SelectItem>
              <SelectItem value="cancelled" className="font-mono">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <ScrollArea className="flex-1 px-6 py-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : records.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Pill className="h-12 w-12 mx-auto mb-3 opacity-40" />
            <p className="font-medium text-foreground">No medication history found</p>
            <p className="text-sm mt-1">
              No records matched the current filter for this patient.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {records.map((record) => (
              <article
                key={record.id}
                className="rounded-xl border border-border bg-card px-4 py-4"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-display text-lg text-foreground">
                        {record.medication_name}
                      </h3>
                      <Badge
                        variant="outline"
                        className={cn('font-mono text-[10px]', STATUS_BADGE_CLASS[record.status])}
                      >
                        {record.status_display}
                      </Badge>
                    </div>
                    <p className="font-mono text-xs text-muted-foreground mt-1">
                      {record.dosage} · {record.route} · {record.frequency}
                    </p>
                    {record.prescriber_name && (
                      <p className="text-sm text-muted-foreground mt-2">
                        Prescribed by {record.prescriber_name}
                      </p>
                    )}
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2 lg:min-w-[280px]">
                    <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
                      <div className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        Scheduled
                      </div>
                      <p className="font-mono text-xs text-foreground mt-1">
                        {formatDateTime(record.scheduled_time)}
                      </p>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
                      <div className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        Administered
                      </div>
                      <p className="font-mono text-xs text-foreground mt-1">
                        {formatDateTime(record.administered_time)}
                      </p>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </ScrollArea>

      <footer className="px-6 py-3 border-t border-border bg-card">
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-[10px] text-muted-foreground">
            {data?.count ?? 0} records
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((current) => Math.max(current - 1, 1))}
              disabled={!data?.has_previous}
              className="font-mono text-xs"
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Prev
            </Button>
            <span className="font-mono text-xs text-muted-foreground">
              Page {data?.page ?? 1}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((current) => current + 1)}
              disabled={!data?.has_next}
              className="font-mono text-xs"
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      </footer>
    </WorkspaceShell>
  );
};

export default MedicationHistorySlideOver;
export { MedicationHistorySlideOver };
