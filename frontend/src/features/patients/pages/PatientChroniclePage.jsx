/* oxlint-disable react-doctor/prefer-useReducer -- These components keep independent UI states; a reducer would add dispatch indirection without a shared transition invariant. */
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import { lazy, Suspense, useState, useMemo, useCallback, useEffect } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import PatientIdentityHero from "@/components/chronicle/PatientIdentityHero";
import ClinicalSummarySidebar from "@/components/chronicle/ClinicalSummarySidebar";
import BreakGlassDialog from "@/components/chronicle/BreakGlassDialog";
import { DischargeCasePanel } from "@/features/discharge/components/DischargeCasePanel";
import ChronicleTimelinePanel from "@/features/patients/chronicle/ChronicleTimelinePanel";
import ChronicleWorkspaceHost from "@/features/patients/components/ChronicleWorkspaceHost";
import { ProblemListSidebar } from "@/features/problems";
import { useChronicleBreakGlassAccess } from "@/features/patients/chronicle/useChronicleBreakGlassAccess";
import { useChronicleOnboardingEvents } from "@/features/patients/chronicle/useChronicleOnboardingEvents";
import { useChroniclePatientRecord } from "@/features/patients/chronicle/useChroniclePatientRecord";
import { useChronicleRouteState } from "@/features/patients/chronicle/useChronicleRouteState";
import { useChronicleSidebarData } from "@/features/patients/chronicle/useChronicleSidebarData";
import { useChronicleTimelineData } from "@/features/patients/chronicle/useChronicleTimelineData";
import { useChronicleTimelineExpansion } from "@/features/patients/chronicle/useChronicleTimelineExpansion";
import {
  formatEncounterScopeLabel,
  useChronicleTimelineState,
  useChronicleTimelineViewModel,
} from "@/features/patients/chronicle/useChronicleTimelineViewModel";
import { useChronicleVisitScope } from "@/features/patients/chronicle/useChronicleVisitScope";
import { useChronicleWorkspaceRouting } from "@/features/patients/chronicle/useChronicleWorkspaceRouting";
import { useChronicleWorkspaceActions } from "@/features/patients/chronicle/useChronicleWorkspaceActions";
import { useSystemCapabilities } from "@/hooks/useSystemQueries";
import { isRustV2ApiMode } from "@/lib/api/v2/runtime";
import { useDebounce } from "@/hooks/use-debounce";

const WardRoundMode = lazy(() => import('@/features/patients/chronicle/ward-round/WardRoundMode'))
const DISCHARGE_CASE_ROLES = new Set([
  'admin',
  'doctor',
  'nurse',
  'head_nurse',
  'nurse_practitioner',
  'inpatient_doctor',
  'practitioner',
  'physician',
  'billing',
]);

function resolveDischargeCaseAdmissionId({
  activeEncounter,
  patient,
  requestedDischargeAdmissionId,
  rustV2ActiveAdmissionId,
}) {
  return requestedDischargeAdmissionId
    || patient?.local_data?.current_admission_id
    || patient?.current_admission_id
    || rustV2ActiveAdmissionId
    || activeEncounter?.admission_id
    || null;
}

function useChronicleWardBoardAccess({
  chronicleActiveAdmission,
  deploymentCapabilities,
  id,
  navigate,
  patient,
  patientLocalId,
  rustV2ActiveAdmissionId,
}) {
  const enabledFeatures = deploymentCapabilities?.features;
  const hasWardBoardContext = Boolean(
    patient?.local_data?.current_admission_id
    || patient?.current_admission_id
    || rustV2ActiveAdmissionId
    || chronicleActiveAdmission
  );
  const canOpenWardBoard = hasWardBoardContext
    && enabledFeatures?.ward_task_board === true
    && enabledFeatures?.patient_chronicle === true
    && enabledFeatures?.wards === true
    && enabledFeatures?.inpatient_admissions === true
    && enabledFeatures?.nursing_workflows === true;
  const wardBoardHref = useMemo(() => {
    const boardPatientId = patientLocalId || id;
    return boardPatientId
      ? `/ward-board?patient=${encodeURIComponent(boardPatientId)}`
      : '/ward-board';
  }, [id, patientLocalId]);
  const handleOpenWardBoard = useCallback(() => {
    navigate(wardBoardHref);
  }, [navigate, wardBoardHref]);

  return {
    canOpenWardBoard,
    handleOpenWardBoard,
  };
}

function ChronicleAccessDeniedState({
  breakGlassExpiresAt,
  breakGlassReason,
  canRequestBreakGlass,
  isBreakGlassOpen,
  isSubmitting,
  pageMeta,
  patient,
  patientName,
  rustV2Mode,
  onBreakGlassOpenChange,
  onBreakGlassReasonChange,
  onBreakGlassSubmit,
}) {
  const patientDetails = patient?.local_data || patient;
  const patientMrn = patientDetails?.medical_record_number || patientDetails?.mrn;

  return (
    <>
      {pageMeta}
      <div className="min-h-screen bg-background">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-16">
          <div className="rounded-2xl border border-border/70 bg-card/70 p-8 shadow-sm chronicle-card-glow">
            <div className="flex flex-col gap-6">
              <div className="flex items-center gap-2">
                <span className="badge-chronicle-rose text-[10px] uppercase tracking-[0.2em]">
                  Access Restricted
                </span>
                {breakGlassExpiresAt && (
                  <span className="badge-chronicle-amber text-[10px]">
                    Break-glass active
                  </span>
                )}
              </div>

              <div className="space-y-2">
                <h2 className="font-display text-2xl text-foreground">
                  Team-based access required
                </h2>
                <p className="text-sm text-muted-foreground">
                  This patient record is protected by team-based access controls.
                  Request break-glass only for urgent clinical need. All access is audited.
                </p>
              </div>

              <div className="rounded-xl border border-border/70 bg-background/60 p-4">
                <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Patient
                </p>
                <p className="text-sm text-foreground">
                  {patientName || "Unknown Patient"}
                </p>
                {patientMrn && (
                  <p className="text-xs text-muted-foreground">MRN {patientMrn}</p>
                )}
              </div>

              {canRequestBreakGlass ? (
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    onClick={() => onBreakGlassOpenChange(true)}
                    className="bg-[oklch(0.65_0.22_15)] text-white hover:bg-[oklch(0.60_0.22_15)]"
                  >
                    Request Break-Glass Access
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Provide a reason to unlock this record for a limited time.
                  </span>
                </div>
              ) : rustV2Mode ? (
                <p className="text-xs text-muted-foreground">
                  Break-glass access is not available in Rust V2 mode.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Break-glass access is available to clinical staff only.
                </p>
              )}
            </div>
          </div>
        </div>

        {canRequestBreakGlass && (
          <BreakGlassDialog
            open={isBreakGlassOpen}
            onOpenChange={onBreakGlassOpenChange}
            patientName={patientName}
            patientMrn={patientMrn}
            reason={breakGlassReason}
            onReasonChange={onBreakGlassReasonChange}
            onSubmit={onBreakGlassSubmit}
            isSubmitting={isSubmitting}
            ttlMinutes={30}
          />
        )}
      </div>
    </>
  );
}

function ChronicleLoadingState({ pageMeta }) {
  return (
    <>
      {pageMeta}
      <div className="min-h-screen bg-background">
        <div className="bg-card border-b border-border px-6 py-8">
          <Skeleton className="h-12 w-64 mb-4" />
          <Skeleton className="h-4 w-96 mb-2" />
          <Skeleton className="h-4 w-48" />
        </div>

        <div className="flex">
          <div className="w-80 border-r border-border p-6 space-y-6">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
          <div className="flex-1 p-6 space-y-4">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        </div>
      </div>
    </>
  );
}

function ChronicleErrorState({ gateError, pageMeta, onRetry }) {
  return (
    <>
      {pageMeta}
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <h2 className="text-2xl font-display text-foreground">
            Unable to load patient record
          </h2>
          <p className="text-muted-foreground">
            {gateError?.message || 'An error occurred while fetching patient data.'}
          </p>
          <Button onClick={onRetry}>
            <RefreshCw className="size-4 mr-2" />
            Try Again
          </Button>
        </div>
      </div>
    </>
  );
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
      <DischargeCasePanel
        admissionId={admissionId}
        title="Discharge Clearance"
      />
    </div>
  );
}

function ChronicleSidebar({
  activeEncounter,
  allergies,
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
  return (
    <div
      className={cn(
        'hidden lg:flex lg:flex-col',
        isAnySlideOverOpen && 'lg:hidden',
      )}
    >
      <div className="w-80 border-r border-border bg-muted/20 p-6">
        {!rustV2Mode && <ProblemListSidebar patientId={patientId} />}
      </div>
      <ClinicalSummarySidebar
        patient={patient}
        problems={rustV2Mode ? problems : []}
        medications={medications}
        allergies={allergies}
        vitals={recentVitals}
        labResults={labResults}
        encounter={activeEncounter}
        onViewVitalsTrends={onViewVitalsTrends}
        onViewFluidTrends={onViewFluidTrends}
      />
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

function PatientChroniclePageContent({
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

  return (
    <>
      {pageMeta}
      <div className="min-h-screen max-w-full overflow-x-hidden bg-background">
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

        <WardBoardQuickAction
          canOpenWardBoard={canOpenWardBoard}
          onOpenWardBoard={handleOpenWardBoard}
        />

        <ChronicleDischargeClearance
          admissionId={dischargeCaseAdmissionId}
          canViewDischargeCase={canViewDischargeCase}
        />

        <div className={cn(
          "flex min-w-0 max-w-full overflow-x-hidden transition-all duration-300",
          isCopilotSlideOverOpen
            ? "lg:mr-[34rem]"
            : isAnySlideOverOpen && "lg:mr-[50%]"
        )}>
          <ChronicleSidebar
            activeEncounter={activeEncounter}
            allergies={allergies}
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
            )}
          </main>

          <ChronicleWorkspaceHost
            activeWorkspace={slideOvers.activeSlideOver}
            workspaceContext={workspaceContext}
          />
        </div>
      </div>
    </>
  );
}

function usePatientChroniclePageModel(defaultAction) {
  const { id } = useParams();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const { user, loading: authLoading } = useAuth();
  const { data: deploymentCapabilities } = useSystemCapabilities({ enabled: !authLoading });
  const queryClient = useQueryClient();
  const [activeFilter, setActiveFilter] = useState('all');
  const [searchInput, setSearchInput] = useState('');
  const rustV2Mode = isRustV2ApiMode();
  const canUseStandaloneClinicalWorkflows = !rustV2Mode;
  const canUseAiAssistant = !rustV2Mode;

  const {
    activeEncounter,
    areEncountersLoading,
    canFetchClinical,
    chronicleActiveAdmission,
    chronicleContext,
    contextError,
    encounters,
    error,
    hasClinicalAccess,
    isContextLoading,
    isLoading,
    pageMeta,
    patient,
    patientForChronicle,
    patientIdentityId,
    patientInsurance,
    patientLocalId,
    patientName,
    refetchContext,
    refetchEncounters,
    refetchPatient,
    refetchStartup,
    rustV2ActiveAdmissionId,
    startupError,
  } = useChroniclePatientRecord({ id, rustV2Mode });
  const {
    clearQueryParams,
    openChronicleWorkspace,
    openWardRoundMode,
    prefetchActionResources,
    slideOvers,
  } = useChronicleWorkspaceRouting({
    id,
    navigate,
    patientLocalId,
    pathname,
    queryClient,
    search,
  });

  const {
    isWardRoundMode,
    referralIdParam,
    requestedDischargeAdmissionId,
    requestedTreatmentSheetAdmissionId,
    setRequestedDischargeAdmissionId,
    setRequestedTreatmentSheetAdmissionId,
    visitParam,
  } = useChronicleRouteState({
    canUseStandaloneClinicalWorkflows,
    clearQueryParams,
    defaultAction,
    id,
    openChronicleWorkspace,
    openWardRoundMode,
    patient,
    search,
  });

  const debouncedSearch = useDebounce(searchInput, 300);

  const isAnySlideOverOpen = slideOvers.activeSlideOver !== null;
  const isCopilotSlideOverOpen = slideOvers.isOpen('copilot');

  const canViewDischargeCase = !rustV2Mode && DISCHARGE_CASE_ROLES.has(user?.user_type);
  const {
    canOpenWardBoard,
    handleOpenWardBoard,
  } = useChronicleWardBoardAccess({
    chronicleActiveAdmission,
    deploymentCapabilities,
    id,
    navigate,
    patient,
    patientLocalId,
    rustV2ActiveAdmissionId,
  });

  const {
    chartContextAdmissionId,
    chartContextEncounter,
    chronicleVisitState,
    handleViewAllHistory,
    handleViewCurrentVisit,
    handleVisitScopeChange,
    isAllVisitsScope,
    isVisitScopePending,
    resolvedVisitScope,
    selectedEncounter,
    selectedEncounterId,
    visitScopeRedirectSearch,
    visitScopeOptions,
  } = useChronicleVisitScope({
    activeEncounter,
    activeEncounterId: chronicleContext?.active_encounter?.id,
    areEncountersLoading,
    canFetchClinical,
    encounters,
    formatEncounterScopeLabel,
    navigate,
    pathname,
    rustV2ActiveAdmissionId,
    rustV2Mode,
    search,
    visitParam,
  });

  useEffect(() => {
    if (!visitScopeRedirectSearch) {
      return;
    }

    navigate({ pathname, search: visitScopeRedirectSearch }, { replace: true });
  }, [navigate, pathname, visitScopeRedirectSearch]);

  useChronicleOnboardingEvents({
    activeFilter,
    hasClinicalAccess,
    patientLocalId,
  });

  const {
    allergies,
    copilotPatientName,
    labResults,
    latestVitals,
    medications,
    problemSummaries,
    recentVitals,
  } = useChronicleSidebarData({ chronicleContext, patient });

  const {
    fetchNextPage,
    hasNextPage,
    invalidateTimeline,
    isFetchingNextPage,
    isTimelineLoading,
    loadMoreRef,
    refetchTimeline,
    timelineDisplayData,
  } = useChronicleTimelineData({
    activeFilter,
    canFetchClinical,
    chronicleContext,
    debouncedSearch,
    isWardRoundMode,
    patientId: id,
    resolvedVisitScope,
    rustV2Mode,
    selectedEncounterId,
  });

  const {
    filteredEntries,
    groupedByEncounter,
    mobileWorkspaceContext,
    totalCount,
  } = useChronicleTimelineViewModel({
    activeEncounter,
    activeFilter,
    chartContextEncounter,
    encounters,
    isAllVisitsScope,
    labResults,
    medications,
    patientName,
    recentVitals,
    timelineDisplayData,
  });

  const timelineExpansion = useChronicleTimelineExpansion({
    activeEncounterId: activeEncounter?.id,
    activeFilter,
    areEncountersLoading,
    debouncedSearch,
    filteredEntries,
    groupedByEncounter,
    patientId: id,
    resolvedVisitScope,
  });

  const handleStartWardRound = useCallback(() => {
    openWardRoundMode();
  }, [openWardRoundMode]);
  const workspaceActions = useChronicleWorkspaceActions({
    activeEncounter,
    activeFilter,
    canUseAiAssistant,
    canUseStandaloneClinicalWorkflows,
    chartContextAdmissionId,
    chartContextEncounter,
    copilotPatientName,
    id,
    invalidateTimeline,
    isAllVisitsScope,
    mobileWorkspaceContext,
    navigate,
    openChronicleWorkspace,
    openWardRoundMode,
    patient,
    patientForChronicle,
    patientIdentityId,
    refetchContext,
    refetchPatient,
    refetchStartup,
    refetchTimeline,
    referralIdParam,
    requestedDischargeAdmissionId,
    requestedTreatmentSheetAdmissionId,
    rustV2ActiveAdmissionId,
    rustV2Mode,
    searchInput,
    selectedEncounterId,
    setRequestedDischargeAdmissionId,
    setRequestedTreatmentSheetAdmissionId,
    slideOvers,
  });

  const dischargeCaseAdmissionId = resolveDischargeCaseAdmissionId({
    activeEncounter,
    patient,
    requestedDischargeAdmissionId,
    rustV2ActiveAdmissionId,
  });

  const handleClearTimelineSearch = useCallback(() => {
    setSearchInput('');
  }, []);
  const handleRetryGate = useCallback(() => {
    refetchPatient();
    refetchContext();
  }, [refetchContext, refetchPatient]);

  const chronicleTimelineState = useChronicleTimelineState({
    hasNextPage,
    isFetchingNextPage,
    isTimelineLoading,
    isVisitScopePending,
  });

  const hasGateError = (contextError && contextError?.status !== 403) || (error && error?.status !== 403);
  const gateError = contextError && contextError?.status !== 403 ? contextError : error;
  const {
    accessDenied,
    breakGlassExpiresAt,
    breakGlassReason,
    canRequestBreakGlass,
    isBreakGlassOpen,
    isSubmittingBreakGlass,
    setBreakGlassOpen,
    setBreakGlassReason,
    submitBreakGlass,
  } = useChronicleBreakGlassAccess({
    patient,
    patientId: id,
    isLoading,
    refetchContext,
    refetchEncounters,
    refetchPatient,
    refetchTimeline,
    rustV2Mode,
    startupError,
    user,
  });

  return {
    accessDenied,
    accessDeniedProps: {
      breakGlassExpiresAt,
      breakGlassReason,
      canRequestBreakGlass,
      isBreakGlassOpen,
      isSubmitting: isSubmittingBreakGlass,
      pageMeta,
      patient,
      patientName,
      rustV2Mode,
      onBreakGlassOpenChange: setBreakGlassOpen,
      onBreakGlassReasonChange: setBreakGlassReason,
      onBreakGlassSubmit: submitBreakGlass,
    },
    contentProps: {
      activeEncounter,
      activeFilter,
      allergies,
      chronicleActiveAdmission,
      chronicleContext,
      chronicleTimelineState,
      dischargeState: { canViewDischargeCase, dischargeCaseAdmissionId },
      encounters,
      fetchNextPage,
      filteredEntries,
      groupedByEncounter,
      handleClearTimelineSearch,
      handleOpenWardBoard,
      handleStartWardRound,
      handleViewAllHistory,
      handleViewCurrentVisit,
      handleVisitScopeChange,
      isAnySlideOverOpen,
      labResults,
      latestVitals,
      loadMoreRef,
      medications,
      modeState: {
        canOpenWardBoard,
        canUseAiAssistant,
        canUseStandaloneClinicalWorkflows,
        isCopilotSlideOverOpen,
        isWardRoundMode,
        rustV2Mode,
      },
      pageMeta,
      patientForChronicle,
      patientId: id,
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
      totalCount,
      user,
      visitScopeOptions,
      visitState: chronicleVisitState,
      workspaceActions,
    },
    errorProps: {
      gateError,
      pageMeta,
      onRetry: handleRetryGate,
    },
    isGateError: hasGateError,
    isGateLoading: isLoading || isContextLoading || authLoading,
    pageMeta,
  };
}

/**
 * PatientChroniclePage - Magazine-style patient health record view
 *
 * @param {string} defaultAction - Optional action to trigger on mount (e.g., 'ward_round')
 */
const PatientChroniclePage = ({ defaultAction }) => {
  const {
    accessDenied,
    accessDeniedProps,
    contentProps,
    errorProps,
    isGateError,
    isGateLoading,
    pageMeta,
  } = usePatientChroniclePageModel(defaultAction);

  if (accessDenied) {
    return <ChronicleAccessDeniedState {...accessDeniedProps} />;
  }

  if (isGateLoading) {
    return <ChronicleLoadingState pageMeta={pageMeta} />;
  }

  if (isGateError) {
    return <ChronicleErrorState {...errorProps} />;
  }

  return <PatientChroniclePageContent {...contentProps} />;
};

export default PatientChroniclePage;
