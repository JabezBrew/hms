import X from 'lucide-react/dist/esm/icons/x.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import History from 'lucide-react/dist/esm/icons/history.js';
import { useMemo, useRef, useState } from 'react';
import format from 'date-fns/format';

import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useChartAssignment, useChartEntries, usePaginatedChartAssignments } from '@/features/charts/hooks';
import { ChartDataGrid } from './ChartDataGrid';
import { LazyChartTrendGraph } from './LazyChartTrendGraph';
import { ChartBodyMapReview } from './ChartBodyMapReview';

const STATUS_BADGE_CLASS = {
  active: 'bg-emerald-600 text-white',
  paused: 'bg-amber-600 text-white',
  completed: 'bg-sky-600 text-white',
  discontinued: 'bg-rose-600 text-white',
};

function formatDateTime(value) {
  if (!value) return '—';
  try {
    return format(new Date(value), 'MMM d, yyyy h:mm a');
  } catch {
    return value;
  }
}

const ChartHistorySlideOver = ({
  open,
  onClose,
  patient,
  initialAssignmentId = null,
  encounterId = null,
  admissionId = null,
  allHistory = false,
}) => {
  const patientId = patient?.local_data?.id || patient?.id;
  const patientName = patient?.local_data?.user_details
    ? `${patient.local_data.user_details.first_name || ''} ${patient.local_data.user_details.last_name || ''}`.trim()
    : patient?.name || 'Patient';

  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState(initialAssignmentId);
  const [selectedTrendField, setSelectedTrendField] = useState('');
  const previousOpenRef = useRef(open);
  const pageScope = `${patientId || ''}:${statusFilter}`;
  const previousPageScopeRef = useRef(pageScope);

  if (previousOpenRef.current !== open) {
    previousOpenRef.current = open;
    if (open) {
      setSelectedAssignmentId(initialAssignmentId || null);
    } else {
      setStatusFilter('all');
      setPage(1);
      setSelectedAssignmentId(null);
      setSelectedTrendField('');
    }
  }

  if (previousPageScopeRef.current !== pageScope) {
    previousPageScopeRef.current = pageScope;
    if (page !== 1) {
      setPage(1);
    }
  }

  const { data, isLoading } = usePaginatedChartAssignments(
    {
      patient: patientId,
      status: statusFilter,
      encounter_id: encounterId,
      admission: admissionId,
      all_history: allHistory,
      page,
      page_size: 12,
      ordering: '-created_at',
    },
    {
      enabled: open,
    },
  );

  const { data: selectedAssignment, isLoading: selectedAssignmentLoading } = useChartAssignment(selectedAssignmentId);
  const { data: selectedEntriesData, isLoading: selectedEntriesLoading } = useChartEntries(
    {
      assignment: selectedAssignmentId,
      include_data: true,
      ordering: '-observation_datetime',
    },
    {
      enabled: open && !!selectedAssignmentId,
    },
  );

  const assignments = useMemo(() => data?.results ?? [], [data]);
  const chartContextLabel = allHistory
    ? 'All history'
    : encounterId
      ? 'Selected visit'
      : admissionId
        ? 'Selected admission'
        : 'Patient scope';

  const defaultTrendField = useMemo(() => {
    const fields = selectedAssignment?.template?.fields || [];
    const firstTrendField = fields.find((field) => ['numeric', 'scale', 'calculated'].includes(field.field_type))
      || fields.find((field) => field.field_type === 'paired');

    if (!selectedAssignmentId || !firstTrendField) {
      return '';
    }

    if (firstTrendField.field_type === 'paired') {
      const defaultComponent = firstTrendField.config?.fields?.[0]?.key;
      return defaultComponent ? `${firstTrendField.field_key}:${defaultComponent}` : '';
    }

    return firstTrendField.field_key;
  }, [selectedAssignment?.template?.fields, selectedAssignmentId]);

  const trendResetToken = `${selectedAssignmentId || ''}:${defaultTrendField}`;
  const previousTrendResetTokenRef = useRef(trendResetToken);

  if (previousTrendResetTokenRef.current !== trendResetToken) {
    previousTrendResetTokenRef.current = trendResetToken;
    setSelectedTrendField(defaultTrendField);
  }

  return (
    <div
      className={cn(
        'fixed inset-y-0 right-0 z-[100] w-full lg:w-1/2 bg-background border-l border-border',
        'transform transition-transform duration-300 ease-in-out',
        'flex flex-col shadow-2xl',
        open ? 'translate-x-0' : 'translate-x-full',
      )}
    >
      <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-amber-100 dark:bg-amber-900/30">
            <History className="size-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h2 className="font-display text-xl text-foreground">
              {selectedAssignmentId ? 'Chart Review' : 'Chart History'}
            </h2>
            <p className="font-mono text-xs text-muted-foreground mt-0.5">{patientName}</p>
          </div>
        </div>

        <Button
          variant="destructive"
          size="sm"
          onClick={onClose}
          className="font-mono text-xs bg-red-500 hover:bg-red-600 text-white"
        >
          <X className="size-4 mr-1.5" />
          Close
        </Button>
      </header>

      {selectedAssignmentId ? (
        <>
          <div className="px-6 py-3 border-b border-border bg-muted/20">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedAssignmentId(null)}
              className="font-mono text-xs"
            >
              <ChevronLeft className="size-4 mr-1" />
              Back to Chart List
            </Button>
          </div>

          <ScrollArea className="flex-1 p-6">
            {selectedAssignmentLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            ) : !selectedAssignment ? (
              <div className="text-center py-16 text-muted-foreground">
                <ClipboardList className="size-12 mx-auto mb-3 opacity-40" />
                <p className="font-medium text-foreground">Chart not found</p>
                <p className="text-sm mt-1">The selected chart assignment could not be loaded.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <article className="rounded-xl border border-border bg-card p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-display text-lg text-foreground">
                          {selectedAssignment.template?.name || selectedAssignment.template_name}
                        </h3>
                        <Badge
                          variant="outline"
                          className={cn('font-mono text-[10px]', STATUS_BADGE_CLASS[selectedAssignment.status])}
                        >
                          {selectedAssignment.status_display}
                        </Badge>
                      </div>
                      {selectedAssignment.reason && (
                        <p className="text-sm text-muted-foreground mt-2">{selectedAssignment.reason}</p>
                      )}
                      {selectedAssignment.instructions && (
                        <p className="text-sm text-muted-foreground mt-2">
                          Instructions: {selectedAssignment.instructions}
                        </p>
                      )}
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
                        <div className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                          <Clock className="size-3" />
                          Started
                        </div>
                        <p className="font-mono text-xs text-foreground mt-1">
                          {formatDateTime(selectedAssignment.start_datetime)}
                        </p>
                      </div>
                      <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
                        <div className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                          <Clock className="size-3" />
                          Ended
                        </div>
                        <p className="font-mono text-xs text-foreground mt-1">
                          {formatDateTime(selectedAssignment.end_datetime || selectedAssignment.discontinued_at)}
                        </p>
                      </div>
                    </div>
                  </div>
                </article>

                <LazyChartTrendGraph
                  assignmentId={selectedAssignmentId}
                  fieldKey={selectedTrendField}
                  onFieldChange={setSelectedTrendField}
                />
                <ChartDataGrid
                  assignmentId={selectedAssignmentId}
                  assignment={selectedAssignment}
                  entriesData={selectedEntriesData}
                  entriesLoading={selectedEntriesLoading}
                />
                <ChartBodyMapReview
                  assignmentId={selectedAssignmentId}
                  assignment={selectedAssignment}
                  entriesData={selectedEntriesData}
                  entriesLoading={selectedEntriesLoading}
                />
              </div>
            )}
          </ScrollArea>
        </>
      ) : (
        <>
          <div className="px-6 py-3 border-b border-border bg-muted/20">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  Monitoring Records
                </p>
                <p className="text-sm text-muted-foreground">
                  Review monitoring charts recorded for this patient. Current context: {chartContextLabel}.
                </p>
              </div>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-[190px] font-mono">
                  <SelectValue placeholder="All charts" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="font-mono">All charts</SelectItem>
                  <SelectItem value="active" className="font-mono">Active</SelectItem>
                  <SelectItem value="paused" className="font-mono">Paused</SelectItem>
                  <SelectItem value="completed" className="font-mono">Completed</SelectItem>
                  <SelectItem value="discontinued" className="font-mono">Discontinued</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <ScrollArea className="flex-1 p-6">
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            ) : assignments.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <ClipboardList className="size-12 mx-auto mb-3 opacity-40" />
                <p className="font-medium text-foreground">No charts found</p>
                <p className="text-sm mt-1">
                  No chart assignments matched the current filter for this patient.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {assignments.map((assignment) => (
                  <button
                    key={assignment.id}
                    type="button"
                    onClick={() => setSelectedAssignmentId(assignment.id)}
                    className="w-full rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/30"
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-display text-lg text-foreground">
                            {assignment.template_name}
                          </h3>
                          <Badge
                            variant="outline"
                            className={cn('font-mono text-[10px]', STATUS_BADGE_CLASS[assignment.status])}
                          >
                            {assignment.status_display}
                          </Badge>
                        </div>
                        <p className="font-mono text-xs text-muted-foreground mt-1">
                          {assignment.effective_interval}
                        </p>
                        <p className="text-sm text-muted-foreground mt-2">
                          Last entry: {formatDateTime(assignment.last_entry_at)}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 text-muted-foreground">
                        <span className="font-mono text-xs">
                          {assignment.entry_count || 0} entries
                        </span>
                        <ChevronRight className="size-4" />
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>

          <footer className="px-6 py-3 border-t border-border bg-card">
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-[10px] text-muted-foreground">
                {data?.count ?? 0} charts
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((current) => Math.max(current - 1, 1))}
                  disabled={!data?.has_previous}
                  className="font-mono text-xs"
                >
                  <ChevronLeft className="size-4 mr-1" />
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
                  <ChevronRight className="size-4 ml-1" />
                </Button>
              </div>
            </div>
          </footer>
        </>
      )}
    </div>
  );
};

export default ChartHistorySlideOver;
export { ChartHistorySlideOver };
