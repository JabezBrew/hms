import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right.js';
import Building2 from 'lucide-react/dist/esm/icons/building-2.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import ShieldAlert from 'lucide-react/dist/esm/icons/shield-alert.js';
import Wifi from 'lucide-react/dist/esm/icons/wifi.js';
import WifiOff from 'lucide-react/dist/esm/icons/wifi-off.js';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { TablePagination } from '@/components/ui/table-pagination';
import { PageState } from '@/shared/components/page/PageState';
import {
  BoardSummaryDrawer,
  BoardToolbar,
  ExpandedPatientDetailPanel,
  MetricStrip,
  PatientRow,
  PatientTable,
  WatchlistPanel,
  getPatientName,
} from '@/features/ward-board/components';
import {
  rowPatientKey,
  useWardBoardPageController,
} from './useWardBoardPageController';

function WardBoardBodyPlaceholder() {
  return (
    <>
      <div className="shrink-0 border-b border-border bg-card/60 px-4 py-3 sm:px-6">
        <div className="flex flex-wrap gap-3">
          <div className="h-10 w-44 rounded-lg bg-muted" />
          <div className="h-10 min-w-56 flex-1 rounded-lg bg-muted" />
          <div className="h-10 w-32 rounded-lg bg-muted" />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <main className="flex min-w-0 flex-1 flex-col overflow-auto p-4">
          <div className="space-y-3">
            <div className="h-14 rounded-lg bg-muted" />
            <div className="h-20 rounded-lg bg-muted" />
            <div className="h-20 rounded-lg bg-muted" />
          </div>
        </main>
      </div>
    </>
  );
}

function WardBoardResolver({ context, onOpenWard, onOpenAllWards }) {
  const assignedWards = Array.isArray(context?.assigned_wards) ? context.assigned_wards : [];
  const canViewAllWards = Boolean(context?.can_view_all_wards);

  if (assignedWards.length === 0 && !canViewAllWards) {
    return (
      <PageState
        variant="empty"
        title="No ward assignment"
        description="A ward assignment is required before opening the ward board."
        icon={ShieldAlert}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[oklch(0.98_0.005_60)] px-6 py-8 text-foreground dark:bg-[oklch(0.14_0.01_50)]">
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        <header>
          <h1 className="font-display text-3xl text-foreground">Ward Board</h1>
          <p className="mt-1 font-mono text-xs text-muted-foreground">Assigned inpatient wards</p>
        </header>

        {assignedWards.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {assignedWards.map((assignment) => (
              <button
                key={assignment.assignment_id || assignment.ward_id}
                type="button"
                onClick={() => onOpenWard(assignment.ward_id)}
                className="flex min-h-28 items-start justify-between gap-4 rounded-lg border border-border bg-card px-4 py-3 text-left shadow-xs transition-colors hover:border-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0">
                  <span className="block truncate font-display text-lg text-foreground">{assignment.ward_name || 'Ward'}</span>
                  <span className="mt-1 block font-mono text-[11px] text-muted-foreground">
                    {assignment.role_name || 'Assigned'}{assignment.is_primary ? ' · Primary' : ''}
                  </span>
                </span>
                <ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            ))}
          </div>
        ) : null}

        {canViewAllWards ? (
          <div className="border-t border-border pt-4">
            <Button type="button" variant="outline" onClick={onOpenAllWards} className="gap-2 font-mono text-xs">
              <Building2 className="size-4" aria-hidden="true" />
              All inpatient wards
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function WardBoardHeader({ title, isFetching, isLiveConnected, summary }) {
  return (
    <header data-perf-ready="ward-board" className="shrink-0 border-b border-border bg-card/80 px-6 py-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-foreground">{title}</h1>
          <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
            Ward Board · Live clinical task board
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
            {isLiveConnected
              ? <Wifi className="size-3.5 text-emerald-500" aria-hidden="true" />
              : <WifiOff className="size-3.5 text-muted-foreground" aria-hidden="true" />}
            <span>{isFetching ? 'Refreshing...' : isLiveConnected ? 'Live' : 'Fallback'}</span>
          </div>
        </div>
      </div>

      <MetricStrip summary={summary} className="mt-4" />
    </header>
  );
}

function WardBoardPatientsMain({ board, actions }) {
  const {
    error,
    isError,
    orderedPatients,
    pageSize,
    resolvedPage,
    rustV2Mode,
    selectedPatientId,
    totalCount,
  } = board;

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-auto">
      {isError ? (
        <div className="mx-4 mt-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
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
          className="m-4 min-h-[360px] rounded-lg border border-dashed border-border bg-card/50"
        />
      ) : (
        <PatientTable>
          {orderedPatients.map((patient, index) => {
            const patientId = rowPatientKey(patient, index);
            return (
              <PatientRow
                key={patientId}
                patient={patient}
                selected={selectedPatientId === patientId}
                onOpenDetail={() => actions.handleOpenPatientDetail(patientId)}
              />
            );
          })}
        </PatientTable>
      )}

      <TablePagination
        currentPage={resolvedPage}
        totalCount={totalCount}
        pageSize={pageSize}
        onPageChange={actions.handlePageChange}
        canJumpToPage={!rustV2Mode}
        countExact={board.boardData?.count_exact !== false && board.boardData?.total_is_lower_bound !== true}
        hasNextPage={Boolean(board.boardData?.next)}
        hasPrevPage={Boolean(board.boardData?.previous) || resolvedPage > 1}
        itemLabel="patients"
        className="shrink-0 border-t border-border px-4 py-3"
      />
    </main>
  );
}

function WardBoardReadyBody({ board, actions }) {
  return (
    <>
      <BoardToolbar
        view={board.view}
        searchValue={board.searchParam}
        patientValue={board.queryPatient}
        wardValue={board.effectiveWard}
        assignedWards={board.assignedWards}
        currentWardId={board.effectiveWard}
        fixedWard={board.fixedWard}
        pageSize={board.pageSize}
        isFetching={board.isFetching}
        searchEnabled
        lockWardSelector={board.allWardScope}
        handoverActive={board.view === 'by-urgency'}
        summary={board.summary}
        onViewChange={actions.handleViewChange}
        onSearchChange={actions.handleSearchChange}
        onWardChange={actions.handleWardChange}
        onAssignedWardChange={actions.handleOpenAssignedWard}
        onPageSizeChange={actions.handlePageSizeChange}
        onClearFilters={actions.handleClearFilters}
        onRefresh={actions.handleRefresh}
        onOpenSummary={actions.handleOpenSummary}
        onHandoverMode={actions.handleHandoverMode}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <WardBoardPatientsMain board={board} actions={actions} />

        <WatchlistPanel
          patients={board.orderedPatients}
          boardData={board.boardData}
          onOpenPatient={actions.handleOpenPatientDetail}
          onViewChange={actions.handleViewChange}
          className="hidden w-72 shrink-0 overflow-hidden xl:flex xl:flex-col"
        />
      </div>

      <BoardSummaryDrawer
        open={board.summaryOpen}
        onOpenChange={actions.handleSummaryOpenChange}
        summary={board.summary}
        patients={board.orderedPatients}
      />

      <WardBoardDetailSheet board={board} actions={actions} />
    </>
  );
}

function WardBoardDetailSheet({ board, actions }) {
  return (
    <Sheet
      open={Boolean(board.selectedPatient)}
      onOpenChange={actions.handleDetailSheetOpenChange}
    >
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-2xl lg:max-w-4xl">
        <SheetHeader className="border-b border-border px-4 py-4 pr-12 sm:px-5">
          <SheetTitle className="font-display text-xl font-normal text-foreground">
            {board.selectedPatient ? getPatientName(board.selectedPatient) : 'Patient details'}
          </SheetTitle>
          <SheetDescription className="font-mono text-[11px]">
            {board.selectedPatientContext || 'Ward-board tasks and blockers'}
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          {board.selectedPatient ? (
            <ExpandedPatientDetailPanel
              patient={board.selectedPatient}
              onTaskAction={actions.handleTaskAction}
              pendingAction={board.pendingAction}
            />
          ) : null}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

function WardBoardReadyView({ pageMeta, board, actions }) {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[oklch(0.98_0.005_60)] text-foreground dark:bg-[oklch(0.14_0.01_50)]">
      {pageMeta}

      <WardBoardHeader
        title={board.currentWardLabel}
        isFetching={board.isFetching}
        isLiveConnected={board.isLiveConnected}
        summary={board.summary}
      />

      {board.showBoardBody ? (
        <WardBoardReadyBody board={board} actions={actions} />
      ) : (
        <WardBoardBodyPlaceholder />
      )}
    </div>
  );
}

export default function WardBoardPage() {
  const controller = useWardBoardPageController();

  if (controller.status === 'context-loading' || controller.status === 'board-loading') {
    return (
      <PageState variant="loading">
        {controller.pageMeta}
      </PageState>
    );
  }

  if (controller.status === 'context-error') {
    return (
      <PageState
        variant="error"
        title="Unable to load ward board context"
        description={controller.error?.message || 'Please try again.'}
        action={controller.onRetry}
        icon={AlertTriangle}
      />
    );
  }

  if (controller.status === 'all-ward-denied') {
    return (
      <PageState
        variant="error"
        title="All-ward board unavailable"
        description="You do not have permission to open the all-ward board."
        icon={ShieldAlert}
      />
    );
  }

  if (controller.status === 'resolver') {
    return (
      <>
        {controller.pageMeta}
        <WardBoardResolver
          context={controller.boardContext}
          onOpenWard={controller.onOpenAssignedWard}
          onOpenAllWards={controller.onOpenAllWards}
        />
      </>
    );
  }

  if (controller.status === 'board-error') {
    return (
      <PageState
        variant="error"
        title="Unable to load ward board"
        description={controller.error?.message || 'Please try again.'}
        action={controller.onRetry}
        icon={AlertTriangle}
      />
    );
  }

  return (
    <WardBoardReadyView
      pageMeta={controller.pageMeta}
      board={controller.board}
      actions={controller.actions}
    />
  );
}
