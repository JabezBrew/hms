import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import { lazy, Suspense, useCallback, useLayoutEffect, useState } from 'react';

import PatientIdentityHero from '@/components/chronicle/PatientIdentityHero';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useAfterInitialPaint } from '@/shared/hooks/useAfterInitialPaint';

const ClinicalSummarySidebar = lazy(() => import('@/components/chronicle/ClinicalSummarySidebar'));
const ChronicleTimelinePanel = lazy(() => import('@/features/patients/chronicle/ChronicleTimelinePanel'));
const ChronicleWorkspaceHost = lazy(() => import('@/features/patients/components/ChronicleWorkspaceHost'));
const DischargeCasePanel = lazy(() => import('@/features/discharge/components/DischargeCasePanel').then((module) => ({
  default: module.DischargeCasePanel,
})));
const ProblemListSidebar = lazy(() => import('@/features/problems').then((module) => ({
  default: module.ProblemListSidebar,
})));
const WardRoundMode = lazy(() => import('@/features/patients/chronicle/ward-round/WardRoundMode'));
const EMPTY_PROBLEMS = [];

function useMeasuredElementHeight() {
  const [element, setElement] = useState(null);
  const [height, setHeight] = useState(null);
  const ref = useCallback((node) => {
    setElement(node);
  }, []);

  useLayoutEffect(() => {
    if (!element) {
      return undefined;
    }

    function updateHeight() {
      const nextHeight = Math.ceil(element.getBoundingClientRect().height);
      if (nextHeight <= 0) {
        return;
      }

      setHeight((previousHeight) => (
        previousHeight === nextHeight ? previousHeight : nextHeight
      ));
    }

    updateHeight();
    window.addEventListener('resize', updateHeight);

    if (typeof ResizeObserver === 'undefined') {
      return () => {
        window.removeEventListener('resize', updateHeight);
      };
    }

    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);

    return () => {
      window.removeEventListener('resize', updateHeight);
      observer.disconnect();
    };
  }, [element]);

  return { height, ref };
}

function WardBoardQuickAction({ canOpenWardBoard, onOpenWardBoard }) {
  if (!canOpenWardBoard) {
    return null;
  }

  return (
    <div className="px-4 pt-4 sm:px-6">
      <Button
        variant="outline"
        size="sm"
        onClick={onOpenWardBoard}
        className="font-mono text-xs"
      >
        <ClipboardList className="size-4 mr-2" />
        Open Ward Board
      </Button>
    </div>
  );
}

function ChronicleDischargeClearance({ admissionId, canViewDischargeCase }) {
  if (!canViewDischargeCase || !admissionId) {
    return null;
  }

  return (
    <div className="px-6 pt-6">
      <Suspense fallback={<Skeleton className="h-24 w-full rounded-lg" />}>
        <DischargeCasePanel
          admissionId={admissionId}
          title="Discharge Clearance"
        />
      </Suspense>
    </div>
  );
}

function ChronicleDeferredBodyPlaceholder() {
  return (
    <div className="p-4 sm:p-6">
      <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <Skeleton className="hidden h-80 rounded-lg lg:block" />
        <div className="space-y-3">
          <Skeleton className="h-16 rounded-lg" />
          <Skeleton className="h-32 rounded-lg" />
          <Skeleton className="h-32 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

function ChronicleSidebar({
  activeEncounter,
  allergies,
  contentHeight,
  isAnySlideOverOpen,
  labResults,
  medications,
  patient,
  patientId,
  problems,
  recentVitals,
  rustV2Mode,
  onViewFluidTrends,
  onViewVitalsTrends,
}) {
  const sidebarMaxHeight = contentHeight
    ? `min(calc(100vh - 5rem), ${contentHeight}px)`
    : 'calc(100vh - 5rem)';
  const sidebarBoundaryStyle = { maxHeight: sidebarMaxHeight };

  return (
    <div
      className={cn(
        'hidden lg:sticky lg:top-20 lg:z-10 lg:flex lg:w-80 lg:min-h-0 lg:flex-col lg:self-start lg:overflow-hidden',
        isAnySlideOverOpen && 'lg:hidden',
      )}
      style={sidebarBoundaryStyle}
    >
      <Suspense fallback={<Skeleton className="h-80 w-full rounded-lg" />}>
        {!rustV2Mode && (
          <div className="w-80 border-r border-border bg-muted/20 p-6">
            <ProblemListSidebar patientId={patientId} />
          </div>
        )}
        <ClinicalSummarySidebar
          patient={patient}
          problems={rustV2Mode ? problems : EMPTY_PROBLEMS}
          medications={medications}
          allergies={allergies}
          vitals={recentVitals}
          labResults={labResults}
          encounter={activeEncounter}
          onViewVitalsTrends={onViewVitalsTrends}
          onViewFluidTrends={onViewFluidTrends}
          style={sidebarBoundaryStyle}
        />
      </Suspense>
    </div>
  );
}

function WardRoundChronicleMode({
  activeEncounter,
  admission,
  chronicleContext,
  labResults,
  latestVitals,
  medications,
  patient,
  patientId,
  onCommitted,
}) {
  return (
    <Suspense fallback={(
      <div className="mx-auto max-w-4xl space-y-4">
        <Skeleton className="h-28 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    )}>
      <WardRoundMode
        patientId={patientId}
        patient={patient}
        admission={admission}
        encounter={activeEncounter}
        chronicleContext={chronicleContext}
        latestVitals={latestVitals}
        labResults={labResults}
        medications={medications}
        onCommitted={onCommitted}
      />
    </Suspense>
  );
}

export function PatientChroniclePageContent({
  activeEncounter,
  activeFilter,
  allergies,
  chronicleActiveAdmission,
  chronicleContext,
  chronicleTimelineState,
  dischargeState,
  encounters,
  fetchNextPage,
  filteredEntries,
  groupedByEncounter,
  handleClearTimelineSearch,
  handleOpenWardBoard,
  handleStartWardRound,
  handleVisitScopeChange,
  handleViewAllHistory,
  handleViewCurrentVisit,
  isAnySlideOverOpen,
  labResults,
  latestVitals,
  loadMoreRef,
  medications,
  pageMeta,
  patientForChronicle,
  patientId,
  patientInsurance,
  patientLocalId,
  prefetchActionResources,
  problemSummaries,
  recentVitals,
  refetchTimeline,
  searchInput,
  selectedEncounter,
  setActiveFilter,
  setSearchInput,
  slideOvers,
  timelineExpansion,
  modeState,
  totalCount,
  user,
  visitScopeOptions,
  visitState,
  workspaceActions,
}) {
  const {
    handleAddNote,
    handleAskChronicle,
    handleCopyNote,
    handleEditNote,
    handleManageInsurance,
    handleOrderLabs,
    handlePrescribe,
    handlePrintSummary,
    handleReceiveRecord,
    handleRecordFluids,
    handleRecordVitals,
    handleRequestConsult,
    handleScheduleFollowUp,
    handleShareRecord,
    handleStartDischarge,
    handleViewMedicationHistory,
    handleViewTreatmentSheet,
    handleViewTrends,
    refreshData,
    workspaceContext,
  } = workspaceActions;
  const {
    canOpenWardBoard,
    canUseAiAssistant,
    canUseStandaloneClinicalWorkflows,
    isCopilotSlideOverOpen,
    isWardRoundMode,
    rustV2Mode,
  } = modeState;
  const {
    canViewDischargeCase,
    dischargeCaseAdmissionId,
  } = dischargeState;
  const {
    collapseAll,
    expandAll,
    expandedEncounters,
    expandedNoteIds,
    toggleEncounter,
    toggleNoteExpanded,
  } = timelineExpansion;
  const contentMeasure = useMeasuredElementHeight();
  const showChronicleBody = useAfterInitialPaint({
    minimumDelayMs: 200,
    timeoutMs: 450,
  });

  return (
    <>
      {pageMeta}
      <div className="min-h-screen max-w-full overflow-x-clip bg-background">
        <div data-perf-ready="patient-chronicle">
          <PatientIdentityHero
            patient={patientForChronicle}
            allergies={allergies}
            onActionIntent={rustV2Mode ? undefined : prefetchActionResources}
            onAskChronicle={canUseAiAssistant ? handleAskChronicle : undefined}
            onAddNote={handleAddNote}
            onRecordVitals={handleRecordVitals}
            onPrescribe={handlePrescribe}
            onOrderLabs={handleOrderLabs}
            onRequestConsult={handleRequestConsult}
            onShareRecord={handleShareRecord}
            onReceiveRecord={handleReceiveRecord}
            onScheduleFollowUp={handleScheduleFollowUp}
            onViewTreatmentSheet={handleViewTreatmentSheet}
            onViewMedicationHistory={handleViewMedicationHistory}
            onRecordFluids={handleRecordFluids}
            onStartWardRound={handleStartWardRound}
            onStartDischarge={canUseStandaloneClinicalWorkflows ? handleStartDischarge : undefined}
            onManageInsurance={handleManageInsurance}
            onPrintSummary={handlePrintSummary}
            insurance={patientInsurance}
            activeAdmission={chronicleActiveAdmission}
          />
        </div>

        {showChronicleBody ? (
          <>
            <WardBoardQuickAction
              canOpenWardBoard={canOpenWardBoard}
              onOpenWardBoard={handleOpenWardBoard}
            />

            <ChronicleDischargeClearance
              admissionId={dischargeCaseAdmissionId}
              canViewDischargeCase={canViewDischargeCase}
            />

            <div className={cn(
              'flex min-w-0 max-w-full overflow-x-clip transition-all duration-300 lg:items-start',
              isCopilotSlideOverOpen
                ? 'lg:mr-[34rem]'
                : isAnySlideOverOpen && 'lg:mr-[50%]'
            )}>
              <ChronicleSidebar
                activeEncounter={activeEncounter}
                allergies={allergies}
                contentHeight={contentMeasure.height}
                isAnySlideOverOpen={isAnySlideOverOpen}
                labResults={labResults}
                medications={medications}
                patient={patientForChronicle}
                patientId={patientId}
                problems={problemSummaries}
                recentVitals={recentVitals}
                rustV2Mode={rustV2Mode}
                onViewVitalsTrends={() => handleViewTrends('vitals')}
                onViewFluidTrends={() => handleViewTrends('fluids')}
              />
              <main className="min-w-0 flex-1 p-4 pb-[calc(5rem+env(safe-area-inset-bottom))] transition-all duration-300 sm:p-6">
                <div ref={contentMeasure.ref}>
                  {isWardRoundMode ? (
                    <WardRoundChronicleMode
                      activeEncounter={activeEncounter}
                      admission={chronicleActiveAdmission}
                      chronicleContext={chronicleContext}
                      labResults={labResults}
                      latestVitals={latestVitals}
                      medications={medications}
                      patient={patientForChronicle}
                      patientId={patientLocalId || patientId}
                      onCommitted={refreshData}
                    />
                  ) : (
                    <Suspense fallback={(
                      <div className="space-y-3">
                        <Skeleton className="h-16 w-full rounded-lg" />
                        <Skeleton className="h-32 w-full rounded-lg" />
                        <Skeleton className="h-32 w-full rounded-lg" />
                      </div>
                    )}>
                      <ChronicleTimelinePanel
                        activeEncounter={activeEncounter}
                        activeFilter={activeFilter}
                        encounterCount={encounters?.length || 0}
                        expandedEncounters={expandedEncounters}
                        expandedNoteIds={expandedNoteIds}
                        filteredEntries={filteredEntries}
                        groupedByEncounter={groupedByEncounter}
                        loadMoreRef={loadMoreRef}
                        searchInput={searchInput}
                        selectedEncounter={selectedEncounter}
                        timelineState={chronicleTimelineState}
                        totalCount={totalCount}
                        userId={user?.id}
                        visitState={visitState}
                        visitScopeOptions={visitScopeOptions}
                        onClearSearch={handleClearTimelineSearch}
                        onCollapseAll={collapseAll}
                        onCopyNote={handleCopyNote}
                        onEditNote={handleEditNote}
                        onExpandAll={expandAll}
                        onFetchNextPage={fetchNextPage}
                        onFilterChange={setActiveFilter}
                        onNoteUpdated={refetchTimeline}
                        onRecordFluids={handleRecordFluids}
                        onRefresh={refetchTimeline}
                        onSearchInputChange={setSearchInput}
                        onToggleEncounter={toggleEncounter}
                        onToggleNoteExpanded={toggleNoteExpanded}
                        onViewAllHistory={handleViewAllHistory}
                        onViewCurrentVisit={handleViewCurrentVisit}
                        onViewMedicationHistory={handleViewMedicationHistory}
                        onVisitScopeChange={handleVisitScopeChange}
                      />
                    </Suspense>
                  )}
                </div>
              </main>

              <Suspense fallback={null}>
                <ChronicleWorkspaceHost
                  activeWorkspace={slideOvers.activeSlideOver}
                  workspaceContext={workspaceContext}
                />
              </Suspense>
            </div>
          </>
        ) : (
          <ChronicleDeferredBodyPlaceholder />
        )}
      </div>
    </>
  );
}
