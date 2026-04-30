import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { TablePagination } from '@/components/ui/table-pagination';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageState } from '@/shared/components/page/PageState';
import { usePageMeta } from '@/shared/hooks/usePageMeta';
import { useDebounce } from '@/hooks/use-debounce';
import { cn } from '@/lib/utils';
import {
  BoardSummaryDrawer,
  BoardToolbar,
  DEFAULT_BOARD_VIEW,
  DEFAULT_PAGE_SIZE,
  MetricStrip,
  PatientRow,
  WatchlistPanel,
  BOARD_VIEWS,
  compactParams,
  getBoardPatients,
  getBoardSummary,
  getPatientUrgency,
  getWatchlist,
} from '@/features/ward-board/components';
import { useWardBoard, useWardBoardLiveUpdates, useWardBoardTaskAction } from '@/features/ward-board/hooks';

const VIEW_VALUES = new Set(BOARD_VIEWS.map((view) => view.value));
const URGENCY_ORDER = {
  critical: 0,
  urgent: 1,
  high: 2,
  moderate: 3,
  medium: 4,
  pending: 5,
  low: 6,
  stable: 7,
  normal: 8,
};

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getViewLabel(value) {
  return BOARD_VIEWS.find((view) => view.value === value)?.label ?? BOARD_VIEWS[0].label;
}

function orderRowsForView(rows, view) {
  if (view !== 'by-urgency') {
    return rows;
  }
  return [...rows].sort((left, right) => {
    const leftOrder = URGENCY_ORDER[getPatientUrgency(left)] ?? 99;
    const rightOrder = URGENCY_ORDER[getPatientUrgency(right)] ?? 99;
    return leftOrder - rightOrder;
  });
}

export default function WardBoardPage() {
  const { wardId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [expandedPatientId, setExpandedPatientId] = useState(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);

  const fixedWard = wardId || '';
  const queryWard = searchParams.get('ward') || '';
  const effectiveWard = fixedWard || queryWard;
  const viewParam = searchParams.get('view') || DEFAULT_BOARD_VIEW;
  const view = VIEW_VALUES.has(viewParam) ? viewParam : DEFAULT_BOARD_VIEW;
  const page = parsePositiveInt(searchParams.get('page'), 1);
  const pageSize = parsePositiveInt(searchParams.get('page_size'), DEFAULT_PAGE_SIZE);
  const searchParam = searchParams.get('search') || '';
  const [searchDraft, setSearchDraft] = useState(searchParam);
  const debouncedSearch = useDebounce(searchDraft, 300);

  const pageMeta = usePageMeta({
    title: 'Ward Clinical Task Board | Hospital Management System',
    breadcrumbs: fixedWard
      ? [
          { label: 'Wards', path: '/wards' },
          { label: 'Board', path: `/wards/${fixedWard}/board` },
        ]
      : [{ label: 'Ward Board', path: '/ward-board' }],
  });

  const updateParams = useCallback((changes, { resetPage = true, replace = true } = {}) => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      Object.entries(changes).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') {
          next.delete(key);
        } else {
          next.set(key, String(value));
        }
      });
      if (fixedWard) {
        next.delete('ward');
      }
      if (resetPage) {
        next.set('page', '1');
      }
      return next;
    }, { replace });
  }, [fixedWard, setSearchParams]);

  useEffect(() => {
    setSearchDraft(searchParam);
  }, [searchParam]);

  useEffect(() => {
    if (debouncedSearch === searchParam) {
      return;
    }
    updateParams({ search: debouncedSearch.trim() }, { resetPage: true });
  }, [debouncedSearch, searchParam, updateParams]);

  const queryFilters = useMemo(() => compactParams({
    ward: effectiveWard,
    view,
    search: debouncedSearch.trim(),
    page,
    page_size: pageSize,
  }), [debouncedSearch, effectiveWard, page, pageSize, view]);

  const {
    data: boardData,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = useWardBoard(queryFilters);

  const patients = useMemo(() => getBoardPatients(boardData), [boardData]);
  const orderedPatients = useMemo(() => orderRowsForView(patients, view), [patients, view]);
  const summary = useMemo(() => getBoardSummary(boardData, patients), [boardData, patients]);
  const watchlist = useMemo(() => getWatchlist(boardData, patients), [boardData, patients]);
  const totalCount = boardData?.count ?? patients.length;
  const viewLabel = getViewLabel(view);
  const taskMutation = useWardBoardTaskAction();
  const { isConnected: isLiveConnected } = useWardBoardLiveUpdates({
    enabled: !isLoading,
    wardScope: effectiveWard || 'all',
  });

  const handleTaskAction = useCallback(({ taskId, action, patientId }) => {
    setPendingAction({ taskId, action });
    taskMutation.mutate(
      { taskId, action, patientId, payload: {} },
      {
        onSuccess: () => {
          toast.success('Ward board task updated');
        },
        onError: (mutationError) => {
          toast.error(mutationError?.message || 'Unable to update ward board task');
        },
        onSettled: () => {
          setPendingAction(null);
        },
      }
    );
  }, [taskMutation]);

  const handleTogglePatient = useCallback((patientId) => {
    setExpandedPatientId((current) => (current === patientId ? null : patientId));
  }, []);

  const handleClearFilters = useCallback(() => {
    setSearchDraft('');
    updateParams({ search: '', ward: '' }, { resetPage: true });
  }, [updateParams]);

  if (isLoading && !boardData) {
    return (
      <PageState variant="loading">
        {pageMeta}
      </PageState>
    );
  }

  if (isError && !boardData) {
    return (
      <PageState
        variant="error"
        title="Unable to load ward board"
        description={error?.message || 'Please try again.'}
        action={() => refetch()}
        icon={AlertTriangle}
      />
    );
  }

  return (
    <PageShell className="bg-[oklch(0.98_0.005_60)] text-foreground dark:bg-[oklch(0.14_0.01_50)]">
      {pageMeta}
      <PageHeader
        title="Ward Clinical Task Board"
        meta={effectiveWard ? `WARD ${effectiveWard}` : 'ALL WARDS'}
        description={`${viewLabel} view with ${totalCount} matching patients`}
        actions={(
          <div className="flex items-center gap-2 rounded-md border border-border bg-background/70 px-3 py-2 font-mono text-[11px] text-muted-foreground">
            <ClipboardList className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{isFetching ? 'Refreshing' : isLiveConnected ? 'Live board' : 'Refresh fallback'}</span>
          </div>
        )}
      >
        <MetricStrip summary={summary} className="mt-5" />
      </PageHeader>

      <BoardToolbar
        view={view}
        searchValue={searchDraft}
        wardValue={effectiveWard}
        fixedWard={fixedWard}
        pageSize={pageSize}
        isFetching={isFetching}
        onViewChange={(nextView) => updateParams({ view: nextView }, { resetPage: true })}
        onSearchChange={setSearchDraft}
        onWardChange={(nextWard) => updateParams({ ward: nextWard.trim() }, { resetPage: true })}
        onPageSizeChange={(nextPageSize) => updateParams({ page_size: nextPageSize }, { resetPage: true })}
        onClearFilters={handleClearFilters}
        onRefresh={() => refetch()}
        onOpenSummary={() => setSummaryOpen(true)}
      />

      <main className="grid min-h-[520px] lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="min-w-0 p-4 sm:p-6">
          {isError ? (
            <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error?.message || 'Ward board refresh failed.'}
            </div>
          ) : null}

          {orderedPatients.length === 0 ? (
            <PageState
              variant="empty"
              title="No ward board patients"
              description="No operational ward tasks match the current filters."
              icon={ClipboardList}
              fullHeight={false}
              className="min-h-[360px] rounded-lg border border-dashed border-border bg-card/50"
            />
          ) : (
            <div className="space-y-3">
              {orderedPatients.map((patient, index) => {
                const patientId = patient?.patient_id ?? patient?.id ?? patient?.patient?.id ?? index;
                return (
                  <PatientRow
                    key={patientId}
                    patient={patient}
                    expanded={expandedPatientId === patientId}
                    onToggle={() => handleTogglePatient(patientId)}
                    onTaskAction={handleTaskAction}
                    pendingAction={pendingAction}
                  />
                );
              })}
            </div>
          )}

          <TablePagination
            currentPage={page}
            totalCount={totalCount}
            pageSize={pageSize}
            onPageChange={(nextPage) => updateParams({ page: nextPage }, { resetPage: false })}
            hasNextPage={Boolean(boardData?.next)}
            hasPrevPage={Boolean(boardData?.previous) || page > 1}
            itemLabel="patients"
            className={cn('mt-4 px-0', orderedPatients.length === 0 && 'hidden')}
          />
        </section>

        <WatchlistPanel patients={watchlist} />
      </main>

      <BoardSummaryDrawer
        open={summaryOpen}
        onOpenChange={setSummaryOpen}
        summary={summary}
        viewLabel={viewLabel}
        ward={effectiveWard}
        search={debouncedSearch.trim()}
        count={orderedPatients.length}
      />
    </PageShell>
  );
}
