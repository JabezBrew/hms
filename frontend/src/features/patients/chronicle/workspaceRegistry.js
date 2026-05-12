import { laboratoryApi } from '@/features/laboratory/api';
import { labKeys } from '@/features/laboratory/hooks';
import { drugSafetyKeys } from '@/hooks/useDrugSafetyQueries';
import { immutableMetadataQueryOptions } from '@/lib/react-query';
import { drugSafetyApi } from '@/shared/api/drugSafety';

export const chronicleWorkspaceIds = Object.freeze([
  'copilot',
  'note',
  'vitals',
  'prescription',
  'labs',
  'referral',
  'crossFacility',
  'receiveRecord',
  'medicationHistory',
  'treatmentSheet',
  'fluids',
  'trends',
  'insurance',
  'wardRound',
  'consultation',
  'discharge',
]);

export const chronicleWorkspaceLoaders = Object.freeze({
  copilot: () => import('@/features/patients/components/ChronicleCopilotSlideOver'),
  note: () => import('@/components/chronicle/AddNoteSlideOver'),
  vitals: () => import('@/components/chronicle/AddVitalsSlideOver'),
  prescription: () => import('@/components/chronicle/AddPrescriptionSlideOver'),
  labs: () => import('@/components/laboratory/LabOrderForm'),
  referral: () => import('@/components/referrals/ReferralForm'),
  crossFacility: () => import('@/components/consent/CrossFacilitySharePanel'),
  receiveRecord: () => import('@/components/interop/ReceiveRecordPanel'),
  medicationHistory: () => import('@/components/chronicle/MedicationHistorySlideOver'),
  treatmentSheet: () => import('@/components/chronicle/TreatmentSheetSlideOver'),
  fluids: () => import('@/components/chronicle/AddFluidBalanceSlideOver'),
  trends: () => import('@/components/chronicle/TrendReviewSlideOver'),
  insurance: () => import('@/components/chronicle/PatientInsuranceSlideOver'),
  wardRound: () => import('@/components/chronicle/WardRoundSlideOver'),
  consultation: () => import('@/components/chronicle/ConsultationSlideOver'),
  discharge: () => import('@/components/chronicle/DischargeSlideOver'),
});

export function isChronicleWorkspace(workspaceId) {
  return chronicleWorkspaceIds.includes(workspaceId);
}

export function getChronicleAdmissionReference(patient, overrideAdmissionId = null) {
  const admissionId = overrideAdmissionId
    || patient?.local_data?.current_admission_id
    || patient?.current_admission_id
    || null;

  return admissionId ? { id: String(admissionId) } : null;
}

export function prefetchChronicleWorkspaceResources(
  workspaceId,
  { patientLocalId, queryClient, loaders = chronicleWorkspaceLoaders } = {},
) {
  const loadWorkspace = loaders?.[workspaceId];
  if (typeof loadWorkspace === 'function') {
    loadWorkspace();
  }

  if (!queryClient) {
    return;
  }

  if (workspaceId === 'prescription' && patientLocalId) {
    void queryClient.prefetchQuery({
      queryKey: drugSafetyKeys.patientAllergies(patientLocalId),
      queryFn: ({ signal }) => drugSafetyApi.getPatientAllergies(patientLocalId, { signal }),
      staleTime: 60 * 1000,
    });
    return;
  }

  if (workspaceId === 'labs') {
    void queryClient.prefetchQuery({
      queryKey: labKeys.testsList({}),
      queryFn: () => laboratoryApi.getLabTests({}),
      ...immutableMetadataQueryOptions(),
    });
    void queryClient.prefetchQuery({
      queryKey: labKeys.panelsList({}),
      queryFn: () => laboratoryApi.getLabPanels({}),
      ...immutableMetadataQueryOptions(),
    });
    return;
  }

  if (workspaceId === 'trends') {
    return;
  }
}

export function buildChronicleWorkspaceProps(workspaceId, context) {
  if (!isChronicleWorkspace(workspaceId) || !context) {
    return null;
  }

  const {
    patientId,
    patient,
    activeEncounter,
    selectedEncounterId,
    selectedAdmissionId,
    chronicleAllHistory,
    initialTrendTab,
    patientIdentityId,
    referralId,
    copilotPatientName,
    copyForwardData,
    editNoteData,
    requestedDischargeAdmissionId,
    requestedTreatmentSheetAdmissionId,
    onClose,
    onNoteCreated,
    onVitalsRecorded,
    onPrescriptionCreated,
    onLabOrderCreated,
    onReferralCreated,
    onFluidRecorded,
    onWardRoundCompleted,
    onConsultationCompleted,
    onDischargeCompleted,
  } = context;

  switch (workspaceId) {
    case 'copilot':
      return {
        open: true,
        onClose,
        patientId,
        encounterId: activeEncounter?.id || null,
        patientName: copilotPatientName,
      };
    case 'note':
      return {
        open: true,
        onClose,
        patient,
        encounter: activeEncounter,
        onNoteCreated,
        initialTemplate: editNoteData?.template || copyForwardData?.template,
        initialData: editNoteData?.data || copyForwardData?.data,
        editNoteId: editNoteData?.noteId,
      };
    case 'vitals':
      return {
        open: true,
        onClose,
        patient,
        encounter: activeEncounter,
        onVitalsRecorded,
      };
    case 'prescription':
      return {
        open: true,
        onClose,
        patient,
        encounter: activeEncounter,
        onPrescriptionCreated,
      };
    case 'labs':
      return {
        open: true,
        onClose,
        patient,
        encounter: activeEncounter,
        onOrderCreated: onLabOrderCreated,
      };
    case 'referral':
      return {
        open: true,
        onClose,
        patient,
        encounter: activeEncounter,
        onReferralCreated,
      };
    case 'crossFacility':
      return {
        open: true,
        onClose,
        patient,
        patientIdentityId,
      };
    case 'receiveRecord':
      return {
        open: true,
        onClose,
        patient,
      };
    case 'medicationHistory':
      return {
        open: true,
        onClose,
        patient,
      };
    case 'treatmentSheet':
      return {
        open: true,
        onClose,
        patient,
        admission: getChronicleAdmissionReference(patient, requestedTreatmentSheetAdmissionId),
      };
    case 'fluids':
      return {
        open: true,
        onClose,
        patient,
        admission: getChronicleAdmissionReference(patient),
        allowEntry: Boolean(activeEncounter?.id || getChronicleAdmissionReference(patient)),
        onFluidRecorded,
      };
    case 'trends':
      return {
        open: true,
        onClose,
        patient,
        encounterId: selectedEncounterId || null,
        admissionId: selectedAdmissionId || null,
        allHistory: chronicleAllHistory,
        initialTab: initialTrendTab || 'vitals',
      };
    case 'insurance':
      return {
        open: true,
        onClose,
        patient,
      };
    case 'wardRound':
      return {
        open: true,
        onClose,
        patient,
        admission: getChronicleAdmissionReference(patient),
        onComplete: onWardRoundCompleted,
      };
    case 'consultation':
      return {
        open: true,
        onClose,
        patient,
        encounterId: activeEncounter?.id || null,
        referralId,
        onComplete: onConsultationCompleted,
      };
    case 'discharge':
      return {
        open: true,
        onClose,
        patient,
        admission: getChronicleAdmissionReference(patient, requestedDischargeAdmissionId),
        onComplete: onDischargeCompleted,
      };
    default:
      return null;
  }
}
