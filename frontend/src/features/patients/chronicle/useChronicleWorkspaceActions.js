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
}) {
  const [copyForwardData, setCopyForwardData] = useState(null);
  const [editNoteData, setEditNoteData] = useState(null);
  const [trendReviewTab, setTrendReviewTab] = useState('vitals');

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
    openChronicleWorkspace('note');
  }, [openChronicleWorkspace]);

  const handleRecordVitals = useCallback(() => {
    openChronicleWorkspace('vitals');
  }, [openChronicleWorkspace]);

  const handlePrescribe = useCallback(() => {
    openChronicleWorkspace('prescription');
  }, [openChronicleWorkspace]);

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
  }, [setRequestedDischargeAdmissionId, slideOvers]);

  const handleNoteCreated = useCallback(() => {
    refreshData();
    slideOvers.close();
    setCopyForwardData(null);
    setEditNoteData(null);
  }, [refreshData, slideOvers]);

  const handleCopyNote = useCallback((copyData) => {
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
  }, [openChronicleWorkspace]);

  const handleEditNote = useCallback((editData) => {
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
  }, [openChronicleWorkspace]);

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
    const admissionId = activeEncounter?.admission_id
      || activeEncounter?.id
      || patient?.local_data?.current_admission_id
      || patient?.current_admission_id
      || rustV2ActiveAdmissionId;

    if (admissionId) {
      setRequestedTreatmentSheetAdmissionId(String(admissionId));
      openChronicleWorkspace('treatmentSheet');
    } else {
      toast.error('No active admission found for this patient');
    }
  }, [activeEncounter, patient, rustV2ActiveAdmissionId, openChronicleWorkspace, setRequestedTreatmentSheetAdmissionId]);

  const workspaceContext = useMemo(() => ({
    patientId: id,
    patient: patientForChronicle,
    activeEncounter,
    selectedEncounter: chartContextEncounter,
    selectedEncounterId: chartContextEncounter?.id || null,
    selectedAdmissionId: chartContextAdmissionId,
    chronicleAllHistory: isAllVisitsScope,
    initialTrendTab: trendReviewTab,
    patientIdentityId,
    referralId: referralIdParam,
    copilotPatientName,
    copyForwardData,
    editNoteData,
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
    onDischargeCompleted: handleDischargeCompleted,
  }), [
    id,
    patientForChronicle,
    activeEncounter,
    chartContextEncounter,
    chartContextAdmissionId,
    isAllVisitsScope,
    trendReviewTab,
    patientIdentityId,
    referralIdParam,
    copilotPatientName,
    copyForwardData,
    editNoteData,
    requestedDischargeAdmissionId,
    requestedTreatmentSheetAdmissionId,
    mobileWorkspaceContext,
    handleSlideOverClose,
    handleNoteCreated,
    closeAfterRefresh,
    refreshData,
    handleConsultationCompleted,
    handleDischargeCompleted,
  ]);

  return {
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
  };
}
