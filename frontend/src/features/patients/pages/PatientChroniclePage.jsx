/* oxlint-disable react-doctor/prefer-useReducer -- These components keep independent UI states; a reducer would add dispatch indirection without a shared transition invariant. */
import { useState, useMemo, useCallback, useEffect } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { ChronicleAccessDeniedState } from "@/features/patients/chronicle/ChronicleAccessDeniedState";
import { ChronicleErrorState } from "@/features/patients/chronicle/ChronicleErrorState";
import { ChronicleLoadingState } from "@/features/patients/chronicle/ChronicleLoadingState";
import { PatientChroniclePageContent } from "@/features/patients/chronicle/PatientChroniclePageContent";
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
    workspaceOptions,
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
    hasNextPage,
    isTimelineLoading,
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
    workspaceOptions,
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
