import { chartKeys } from '@/features/charts/hooks';
import { laboratoryApi } from '@/features/laboratory/api';
import { labKeys } from '@/features/laboratory/hooks';
import { drugSafetyKeys } from '@/hooks/useDrugSafetyQueries';
import { apiClient } from '@/lib/api-client';
import { immutableMetadataQueryOptions } from '@/lib/react-query';
import { keyWith } from '@/shared/lib/queryKeys';
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
  'fluids',
  'charts',
  'chartEntry',
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
  fluids: () => import('@/components/chronicle/AddFluidBalanceSlideOver'),
  charts: () => import('@/components/charts/AddChartSlideOver'),
  chartEntry: () => import('@/components/charts/ChartEntryForm'),
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
      queryFn: () => drugSafetyApi.getPatientAllergies(patientLocalId),
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

  if (workspaceId === 'charts') {
    void queryClient.prefetchQuery({
      queryKey: keyWith('charts', 'templates', 'list', undefined, undefined, undefined, true),
      queryFn: () => apiClient.get('/charts/templates/?is_active=true'),
      ...immutableMetadataQueryOptions(),
    });
    void queryClient.prefetchQuery({
      queryKey: chartKeys.categories(),
      queryFn: () => apiClient.get('/charts/templates/categories/').then((response) => response.categories),
      ...immutableMetadataQueryOptions(),
    });
    void queryClient.prefetchQuery({
      queryKey: chartKeys.intervals(),
      queryFn: () => apiClient.get('/charts/templates/intervals/').then((response) => response.intervals),
      ...immutableMetadataQueryOptions(),
    });
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
    patientIdentityId,
    referralId,
    copilotPatientName,
    copyForwardData,
    editNoteData,
    activeChartAssignment,
    requestedDischargeAdmissionId,
    onClose,
    onChartWorkspaceClose,
    onNoteCreated,
    onVitalsRecorded,
    onPrescriptionCreated,
    onLabOrderCreated,
    onReferralCreated,
    onFluidRecorded,
    onChartAssigned,
    onChartEntryRecorded,
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
    case 'fluids':
      return {
        open: true,
        onClose,
        patient,
        admission: getChronicleAdmissionReference(patient),
        onFluidRecorded,
      };
    case 'charts':
      return {
        open: true,
        onClose: onChartWorkspaceClose,
        patient,
        admission: getChronicleAdmissionReference(patient),
        onChartAssigned,
      };
    case 'chartEntry':
      return {
        open: true,
        onClose: onChartWorkspaceClose,
        assignmentId: activeChartAssignment?.id,
        patient,
        onEntryRecorded: onChartEntryRecorded,
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
