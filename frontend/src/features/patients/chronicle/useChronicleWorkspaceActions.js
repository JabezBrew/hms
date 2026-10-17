import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  CHRONICLE_ALL_VISITS,
  CHRONICLE_VISIT_PARAM,
} from "@/features/patients/chronicle/visitScopeUtils";

const PRINT_TYPE_MAPPING = {
  all: 'all',
  progress_note: 'notes',
  vitals: 'vitals',
  medication: 'prescriptions',
  lab_result: 'labs',
};

export function useChronicleWorkspaceActions({
  activeEncounter,
  activeFilter,
  canUseAiAssistant,
  canUseStandaloneClinicalWorkflows,
  chartContextAdmissionId,
  chartContextEncounter,
  clinicalPermissions,
  copilotPatientName,
  id,
  invalidateTimeline,
  isAllVisitsScope,
  mobileWorkspaceContext,
  navigate,
  openChronicleWorkspace,
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
}) {
  const [copyForwardData, setCopyForwardData] = useState(null);
  const [editNoteData, setEditNoteData] = useState(null);
  const [trendReviewTab, setTrendReviewTab] = useState('vitals');
  const handleViewPatientHandover = useCallback(() => openChronicleWorkspace('handover'), [openChronicleWorkspace]);
  const handleViewAdmissionFollowUp = useCallback(() => openChronicleWorkspace('admissionAdvisory'), [openChronicleWorkspace]);
  const handleMoveAdmission = useCallback(() => openChronicleWorkspace('admissionMove'), [openChronicleWorkspace]);
  const handleViewMedicationCourses = useCallback(() => openChronicleWorkspace('medicationCourses'), [openChronicleWorkspace]);
  const handleConsultationResponse = useCallback((referralId) => openChronicleWorkspace('referralResponse', { referralId }), [openChronicleWorkspace]);
  const handleViewSelectedAdmissionMar = useCallback(() => {
    if (isAllVisitsScope || !chartContextAdmissionId) return;
    setRequestedTreatmentSheetAdmissionId(String(chartContextAdmissionId));
    openChronicleWorkspace('treatmentSheet');
  }, [chartContextAdmissionId, isAllVisitsScope, openChronicleWorkspace, setRequestedTreatmentSheetAdmissionId]);

  const refreshData = useCallback(() => {
    if (rustV2Mode) {
      Promise.all([
        refetchStartup?.(),
        refetchTimeline?.(),
      ]);
      return;
    }

    Promise.all([
      invalidateTimeline(id),
      refetchPatient(),
      refetchContext(),
    ]);
  }, [id, invalidateTimeline, refetchContext, refetchPatient, refetchStartup, refetchTimeline, rustV2Mode]);

  const handleAskChronicle = useCallback(() => {
    if (!canUseAiAssistant) {
      toast.error('Chronicle copilot is not available in Rust V2 mode yet.');
      return;
    }
    openChronicleWorkspace('copilot');
  }, [canUseAiAssistant, openChronicleWorkspace]);

  const handleAddNote = useCallback(() => {
    if (rustV2Mode && clinicalPermissions?.can_add_note !== true) return;
    openChronicleWorkspace('note');
  }, [clinicalPermissions?.can_add_note, openChronicleWorkspace, rustV2Mode]);

  const handlePreviewNoteTemplate = useCallback(() => {
    if (!rustV2Mode || clinicalPermissions?.can_view_full_clinical !== true) return;
    openChronicleWorkspace('noteTemplatePreview');
  }, [clinicalPermissions?.can_view_full_clinical, openChronicleWorkspace, rustV2Mode]);

  const handleRecordVitals = useCallback(() => {
    if (rustV2Mode && clinicalPermissions?.can_record_vitals !== true) return;
    openChronicleWorkspace('vitals');
  }, [clinicalPermissions?.can_record_vitals, openChronicleWorkspace, rustV2Mode]);

  const handlePrescribe = useCallback(() => {
    if (rustV2Mode && clinicalPermissions?.can_prescribe !== true) return;
    openChronicleWorkspace('prescription');
  }, [clinicalPermissions?.can_prescribe, openChronicleWorkspace, rustV2Mode]);

  const handleOrderLabs = useCallback(() => {
    openChronicleWorkspace('labs');
  }, [openChronicleWorkspace]);

  const handleRequestConsult = useCallback(() => {
    openChronicleWorkspace('referral');
  }, [openChronicleWorkspace]);

  const handleShareRecord = useCallback(() => {
    openChronicleWorkspace('crossFacility');
  }, [openChronicleWorkspace]);

  const handleReceiveRecord = useCallback(() => {
    openChronicleWorkspace('receiveRecord');
  }, [openChronicleWorkspace]);

  const handleRecordFluids = useCallback(() => {
    openChronicleWorkspace('fluids');
  }, [openChronicleWorkspace]);

  const handleStartDischarge = useCallback(() => {
    const admissionId = patient?.local_data?.current_admission_id
      || patient?.current_admission_id
      || rustV2ActiveAdmissionId
      || activeEncounter?.admission_id;

    if (!admissionId) {
      toast.error('No active admission found for this patient');
      return;
    }

    setRequestedDischargeAdmissionId(String(admissionId));
    if (!canUseStandaloneClinicalWorkflows) {
      return;
    }
    openChronicleWorkspace('discharge');
  }, [
    activeEncounter,
    canUseStandaloneClinicalWorkflows,
    openChronicleWorkspace,
    patient,
    rustV2ActiveAdmissionId,
    setRequestedDischargeAdmissionId,
  ]);

  const handleSlideOverClose = useCallback(() => {
    slideOvers.close();
    setCopyForwardData(null);
    setEditNoteData(null);
    setRequestedDischargeAdmissionId(null);
    setRequestedTreatmentSheetAdmissionId?.(null);
  }, [setRequestedDischargeAdmissionId, setRequestedTreatmentSheetAdmissionId, slideOvers]);

  const handleNoteCreated = useCallback(() => {
    refreshData();
    slideOvers.close();
    setCopyForwardData(null);
    setEditNoteData(null);
  }, [refreshData, slideOvers]);

  const handleCopyNote = useCallback((copyData) => {
    if (rustV2Mode && clinicalPermissions?.can_add_note !== true) return;
    if (!copyData.template) {
      toast.error("Cannot copy note", { description: "Template information is missing" });
      return;
    }

    setCopyForwardData({
      template: copyData.template,
      data: copyData.data,
      sectionsCopied: copyData.sectionsCopied,
    });
    setEditNoteData(null);
    openChronicleWorkspace('note');
    toast.success("Note copied", {
      description: `${copyData.sectionsCopied?.length || 0} sections ready to edit`,
    });
  }, [clinicalPermissions?.can_add_note, openChronicleWorkspace, rustV2Mode]);

  const handleEditNote = useCallback((editData) => {
    if (rustV2Mode && clinicalPermissions?.can_add_note !== true) return;
    if (!editData.template) {
      toast.error("Cannot edit note", { description: "Template information is missing" });
      return;
    }

    setEditNoteData({
      noteId: editData.noteId,
      template: editData.template,
      data: editData.data,
    });
    setCopyForwardData(null);
    openChronicleWorkspace('note');
  }, [clinicalPermissions?.can_add_note, openChronicleWorkspace, rustV2Mode]);

  const closeAfterRefresh = useCallback(() => {
    refreshData();
    slideOvers.close();
  }, [refreshData, slideOvers]);

  const handleDischargeCompleted = useCallback(() => {
    refreshData();
    slideOvers.close();
    setRequestedDischargeAdmissionId(null);
  }, [refreshData, setRequestedDischargeAdmissionId, slideOvers]);

  const handleViewMedicationHistory = useCallback(() => {
    openChronicleWorkspace('medicationHistory');
  }, [openChronicleWorkspace]);

  const handleViewTrends = useCallback((tab = 'vitals') => {
    setTrendReviewTab(tab);
    openChronicleWorkspace('trends');
  }, [openChronicleWorkspace]);

  const handleManageInsurance = useCallback(() => {
    openChronicleWorkspace('insurance');
  }, [openChronicleWorkspace]);

  const handlePrintSummary = useCallback(() => {
    if (!id) {
      return;
    }

    const printParams = new URLSearchParams();
    const printVisitScope = selectedEncounterId || CHRONICLE_ALL_VISITS;
    printParams.set(CHRONICLE_VISIT_PARAM, printVisitScope);

    const printType = PRINT_TYPE_MAPPING[activeFilter] || 'all';
    if (printType !== 'all') {
      printParams.set('type', printType);
    }

    const trimmedSearch = searchInput.trim();
    if (trimmedSearch) {
      printParams.set('search', trimmedSearch);
    }

    window.open(
      `/patients/${id}/chronicle/print?${printParams.toString()}`,
      '_blank',
      'noopener,noreferrer',
    );
  }, [activeFilter, id, searchInput, selectedEncounterId]);

  const handleConsultationCompleted = useCallback(() => {
    refetchTimeline?.();
    refetchContext?.();
  }, [refetchTimeline, refetchContext]);

  const handleScheduleFollowUp = useCallback(() => {
    navigate(`/appointments/create?patient=${id}`);
  }, [navigate, id]);

  const handleViewTreatmentSheet = useCallback(() => {
    const admissionId = rustV2ActiveAdmissionId
      || activeEncounter?.admission_case_id
      || activeEncounter?.admission_id
      || patient?.local_data?.current_admission_id
      || patient?.current_admission_id
      || (!rustV2Mode ? activeEncounter?.id : null);

    if (admissionId) {
      setRequestedTreatmentSheetAdmissionId(String(admissionId));
      openChronicleWorkspace('treatmentSheet');
    } else {
      toast.error('No active admission found for this patient');
    }
  }, [activeEncounter, patient, rustV2ActiveAdmissionId, rustV2Mode, openChronicleWorkspace, setRequestedTreatmentSheetAdmissionId]);

  const workspaceContext = useMemo(() => ({
    patientId: id,
    clinicalPermissions,
    patient: patientForChronicle,
    activeEncounter,
    selectedEncounter: chartContextEncounter,
    selectedEncounterId: chartContextEncounter?.id || null,
    selectedAdmissionId: chartContextAdmissionId,
    selectedPlacementRevision: chartContextEncounter?.admission?.placement_revision ?? chartContextEncounter?.placement_revision ?? null,
    selectedWardId: chartContextEncounter?.admission?.ward_id ?? chartContextEncounter?.ward_id ?? null,
    requestedMoveAdmissionId: workspaceOptions?.moveAdmissionId || null,
    onAdmissionMoved: refreshData,
    chronicleAllHistory: isAllVisitsScope,
    initialTrendTab: trendReviewTab,
    patientIdentityId,
    referralId: referralIdParam,
    requestedReferralId: workspaceOptions?.referralId || referralIdParam || null,
    copilotPatientName,
    copyForwardData,
    editNoteData,
    noteDraft: workspaceOptions?.noteDraft || null,
    requestedAdvisoryCaseId: workspaceOptions?.advisoryCaseId || null,
    requestedDischargeAdmissionId,
    requestedTreatmentSheetAdmissionId,
    mobileContext: mobileWorkspaceContext,
    onClose: handleSlideOverClose,
    onNoteCreated: handleNoteCreated,
    onVitalsRecorded: closeAfterRefresh,
    onPrescriptionCreated: closeAfterRefresh,
    onLabOrderCreated: closeAfterRefresh,
    onReferralCreated: closeAfterRefresh,
    onFluidRecorded: refreshData,
    onWardRoundCompleted: closeAfterRefresh,
    onConsultationCompleted: handleConsultationCompleted,
    onConsultationResponse: handleConsultationResponse,
    onDischargeCompleted: handleDischargeCompleted,
    onReviewSelectedAdmissionMar: handleViewSelectedAdmissionMar,
  }), [
    id,
    clinicalPermissions,
    patientForChronicle,
    activeEncounter,
    chartContextEncounter,
    chartContextAdmissionId,
    isAllVisitsScope,
    trendReviewTab,
    patientIdentityId,
    referralIdParam,
    handleConsultationResponse,
    copilotPatientName,
    copyForwardData,
    editNoteData,
    workspaceOptions,
    requestedDischargeAdmissionId,
    requestedTreatmentSheetAdmissionId,
    mobileWorkspaceContext,
    handleSlideOverClose,
    handleNoteCreated,
    closeAfterRefresh,
    refreshData,
    handleConsultationCompleted,
    handleDischargeCompleted,
    handleViewSelectedAdmissionMar,
  ]);

  return {
    handleAddNote,
    handlePreviewNoteTemplate,
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
    handleViewMedicationCourses,
    handleViewSelectedAdmissionMar,
    handleViewPatientHandover,
    handleViewAdmissionFollowUp,
    handleMoveAdmission,
    handleViewTrends,
    refreshData,
    workspaceContext,
  };
}
