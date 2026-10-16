import { normalizeScheduledStockPolicy, scheduledPolicyMatches } from '@/features/pharmacy/prescribing/scheduledStockPolicy';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { handleV2ApiError } from '@/lib/api/v2/errors';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { v2Api } from '@/lib/api/v2/client';
import { acknowledgeWriteResponse, markWriteResponseUncertain } from '@/lib/api/v2/writeUncertainty';
import { toast } from 'sonner';
import { createKeyFactory, keyWith } from '@/shared/lib/queryKeys';
import { invalidateQueryKeys } from '@/shared/lib/queryInvalidation';
import { invalidatePatientTimelineQueries } from './useTimelineQueries';
import { nursingKeys } from './nursing/nursingQueryKeys';
import { normalizePrnPolicy } from '@/features/pharmacy/prescribing/prnPolicy';

/**
 * Prescription mutation hooks for managing prescription lifecycle
 */

// Query keys for prescriptions
const prescriptionKeyFactory = createKeyFactory('prescriptions');
const ACTIVE_PRESCRIPTION_LIST_LIMIT = 50;

export const prescriptionKeys = {
  all: prescriptionKeyFactory.all,
  list: (patientId) => keyWith('prescriptions', 'list', patientId),
  detail: (id) => keyWith('prescriptions', 'detail', id),
  active: (patientId) => keyWith('prescriptions', 'active', patientId),
};

function normalizeIdentifier(value) {
  if (!value) return null;
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'object') {
    return value.id ?? value.uuid ?? null;
  }
  return null;
}

function rethrowAbortError(error) {
  if (error?.name === 'AbortError') {
    throw error;
  }
}

function normalizePrescriptionResponse(prescription = {}) {
  return {
    ...prescription,
    patient: prescription.patient || prescription.patient_id,
    dosage: prescription.dosage || prescription.dose,
    start_date: prescription.start_date || prescription.prescribed_at,
  };
}

function getPrescriptionPatientId(data = {}) {
  return normalizeIdentifier(data.patient || data.patient_id || data.patientId || data.patient?.id);
}

function normalizeDurationDays(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const duration = Number(value);
  if (!Number.isInteger(duration) || duration < 1 || duration > 2147483647) {
    throw new Error('Duration must be a whole number of at least one day.');
  }
  return duration;
}

function normalizeCreatePrescriptionPayload(data = {}) {
  const payload = {
    medication_name: data.medication_name,
    dose: data.dose || data.dosage,
    frequency: data.frequency,
  };
  for (const field of ['instructions', 'reason']) if (data[field] !== undefined) payload[field] = String(data[field]).trim();

  if (data.route !== undefined) {
    payload.route = data.route;
  }
  if (data.inventory_item_id !== undefined) {
    payload.inventory_item_id = data.inventory_item_id;
  }
  const scheduled = normalizeScheduledStockPolicy(data.scheduled_stock_policy);
  if (scheduled && (data.frequency?.trim().toLowerCase() === 'prn' || !data.inventory_item_id || data.prn_policy)) throw new Error('Scheduled stock units require a linked scheduled prescription.');
  if (data.inventory_item_id && data.frequency?.trim().toLowerCase() !== 'prn' && !scheduled) throw new Error('Review stock units for one scheduled dose before saving this linked prescription.');
  if (scheduled) payload.scheduled_stock_policy = scheduled;
  const policy = normalizePrnPolicy(data.prn_policy);
  if (policy) {
    if (data.frequency?.trim().toLowerCase() !== 'prn' || !data.inventory_item_id) throw new Error('As-needed limits require a linked facility medication and as-needed frequency.');
    payload.prn_policy = policy;
  }
  if (data.start_date !== undefined) {
    payload.start_date = data.start_date;
  }
  const durationDays = normalizeDurationDays(data.duration_days);
  if (durationDays !== undefined) payload.duration_days = durationDays;
  if (data.first_dose_at !== undefined) {
    payload.first_dose_at = data.first_dose_at;
  }
  const encounterId = normalizeIdentifier(data.encounter_id || data.encounterId || data.encounter);
  if (encounterId) {
    payload.encounter_id = encounterId;
  }
  const visitId = normalizeIdentifier(data.visit_id || data.visitId || data.visit);
  if (visitId) {
    payload.visit_id = visitId;
  }
  const admissionCaseId = normalizeIdentifier(data.admission_case_id || data.admissionCaseId || data.admission);
  if (admissionCaseId) {
    payload.admission_case_id = admissionCaseId;
  }
  const dischargeCaseId = normalizeIdentifier(data.discharge_case_id || data.dischargeCaseId || data.discharge);
  if (dischargeCaseId) {
    payload.discharge_case_id = dischargeCaseId;
  }

  return payload;
}

function normalizeUpdatePrescriptionPayload(data = {}) {
  const payload = {};
  if (data.medication_name !== undefined || data.name !== undefined) {
    payload.medication_name = data.medication_name ?? data.name;
  }
  if (data.dose !== undefined || data.dosage !== undefined) {
    payload.dose = data.dose ?? data.dosage;
  }
  if (data.frequency !== undefined) {
    payload.frequency = data.frequency;
  }
  for (const field of ['route', 'inventory_item_id', 'start_date', 'first_dose_at']) {
    if (data[field] !== undefined) payload[field] = data[field];
  }
  const durationDays = normalizeDurationDays(data.duration_days);
  if (durationDays !== undefined) payload.duration_days = durationDays;
  if (data.status !== undefined) {
    payload.status = data.status;
  }
  return payload;
}

export async function createPrescription(data, options = {}) {
  if (isRustV2ApiMode()) {
    const patientId = getPrescriptionPatientId(data);
    if (!patientId) {
      throw new Error('Patient is required to create a prescription');
    }
    const generateMar = data.frequency?.trim().toLowerCase() !== 'prn' && (data.generate_mar === 'yes' || data.generate_mar === true);
    const admissionCaseId = normalizeIdentifier(data.admission_case_id || data.admissionCaseId || data.admission);
    const marDays = Number(data.mar_days ?? data.days ?? 7);
    if (generateMar && !admissionCaseId) {
      throw new Error('Active admission is required to generate MAR. Create this prescription without MAR for outpatient care.');
    }
    if (generateMar && (!Number.isInteger(marDays) || marDays < 1 || marDays > 30)) {
      throw new Error('MAR generation must cover between 1 and 30 whole days.');
    }
    let prescription;
    let prescriptionResponse;
    const payload = normalizeCreatePrescriptionPayload(data);
    if (generateMar && !payload.scheduled_stock_policy) throw new Error('A reviewed scheduled stock policy is required before generating MAR.');
    try {
      prescriptionResponse = await v2Api.postPatientPrescriptions(
        { patient_id: patientId },
        payload,
        { signal: options.signal },
      );
      prescription = normalizePrescriptionResponse(prescriptionResponse?.data);
      if (typeof prescription?.id !== 'string' || !prescription.id.trim()) throw new Error('The saved prescription was not confirmed.');
      if (payload.prn_policy && JSON.stringify(normalizePrnPolicy({
        ...prescription.prn_policy,
        expected_stock_unit: prescription.prn_policy?.stock_unit,
      })) !== JSON.stringify(payload.prn_policy)) throw new Error('The saved as-needed limits and stock unit were not confirmed.');
      if (payload.scheduled_stock_policy ? prescription.inventory_item_id !== payload.inventory_item_id || !scheduledPolicyMatches(prescription.scheduled_stock_policy, payload.scheduled_stock_policy) : prescription.scheduled_stock_policy != null) throw new Error('The saved scheduled stock units were not confirmed.');
      acknowledgeWriteResponse(prescriptionResponse);
    } catch (error) {
      rethrowAbortError(error);
      if (!error?.status || error.status < 400 || error.status >= 500 || error.data?.error?.code === 'prescription_create_failed') {
        markWriteResponseUncertain(prescriptionResponse || error);
        const unconfirmed = new Error('The prescription may have been saved. Review the medication list before prescribing it again.');
        unconfirmed.name = 'PrescriptionWriteUnconfirmedError';
        throw unconfirmed;
      }
      const rejected = new Error(handleV2ApiError(error, 'Failed to create prescription'));
      if (['prn_stock_unit_changed', 'prescription_stock_unit_changed'].includes(error.data?.error?.code)) rejected.name = 'PrescriptionStockUnitChangedError';
      throw rejected;
    }
    if (!generateMar) return prescription;

    // The prescription has committed. A later scheduling failure must never turn
    // this into a failed create that the caller retries as a second prescription.
    let marResponse;
    try {
      marResponse = await v2Api.postClinicalPrescriptionGenerateMar(
        { id: prescription.id },
        {
          admission_case_id: admissionCaseId,
          days: marDays,
          ...(data.first_dose_at ? { first_dose_at: data.first_dose_at } : {}),
        },
        { signal: options.signal },
      );
      const marGeneration = marResponse?.data;
      if (marGeneration?.prescription_id !== prescription.id
        || !['created_count', 'existing_count', 'requested_dose_count'].every((field) => Number.isSafeInteger(marGeneration?.[field]) && marGeneration[field] >= 0)) {
        throw new Error('The saved medication schedule was not confirmed.');
      }
      acknowledgeWriteResponse(marResponse);
      return {
        ...prescription,
        mar_generated: !marGeneration?.skipped_reason,
        mar_generation: marGeneration,
        ...(marGeneration?.skipped_reason ? { mar_generation_status: 'skipped' } : {}),
      };
    } catch (error) {
      if (!(error?.status >= 400 && error.status < 500)) markWriteResponseUncertain(marResponse || error);
      return {
        ...prescription,
        mar_generated: false,
        mar_generation_status: error?.status >= 400 && error?.status < 500 ? 'failed' : 'unconfirmed',
      };
    }
  }
  return apiClient.post('/clinical-notes/prescriptions/', data, options);
}

export async function updatePrescription(prescriptionId, data, options = {}) {
  if (isRustV2ApiMode()) {
    try {
      const response = await v2Api.patchClinicalPrescription(
        { id: prescriptionId },
        normalizeUpdatePrescriptionPayload(data),
        { signal: options.signal },
      );
      return normalizePrescriptionResponse(response?.data);
    } catch (error) {
      rethrowAbortError(error);
      throw new Error(handleV2ApiError(error, 'Failed to update prescription'));
    }
  }
  return apiClient.patch(`/clinical-notes/prescriptions/${prescriptionId}/`, data, options);
}

export async function discontinuePrescription(prescriptionId, data = {}, options = {}) {
  if (isRustV2ApiMode()) {
    return updatePrescription(prescriptionId, { status: 'stopped' }, options);
  }
  return apiClient.post(`/clinical-notes/prescriptions/${prescriptionId}/discontinue/`, {
    reason: data.reason,
  }, options);
}

export async function holdPrescription(prescriptionId, data = {}, options = {}) {
  if (isRustV2ApiMode()) {
    return updatePrescription(prescriptionId, { status: 'on_hold' }, options);
  }
  return apiClient.post(`/clinical-notes/prescriptions/${prescriptionId}/hold/`, {
    reason: data.reason,
  }, options);
}

export async function resumePrescription(prescriptionId, _data = {}, options = {}) {
  if (isRustV2ApiMode()) {
    return updatePrescription(prescriptionId, { status: 'active' }, options);
  }
  return apiClient.post(`/clinical-notes/prescriptions/${prescriptionId}/resume/`, {}, options);
}

function getCachedPrescription(queryClient, prescriptionId) {
  if (!prescriptionId) return null;
  return queryClient.getQueryData(prescriptionKeys.detail(prescriptionId));
}

function resolvePrescriptionPatientId(queryClient, { prescriptionId, patientId, sources = [] } = {}) {
  const candidates = [];

  if (patientId) {
    candidates.push(patientId);
  }

  for (const source of sources) {
    if (!source) continue;
    if (typeof source === 'object') {
      candidates.push(source.patient, source.patient_id, source.patientId, source.patient?.id);
    } else {
      candidates.push(source);
    }
  }

  if (prescriptionId) {
    const cachedPrescription = getCachedPrescription(queryClient, prescriptionId);
    if (cachedPrescription) {
      candidates.push(
        cachedPrescription.patient,
        cachedPrescription.patient_id,
        cachedPrescription.patientId,
        cachedPrescription.patient?.id,
      );
    }
  }

  for (const candidate of candidates) {
    const normalized = normalizeIdentifier(candidate);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

export function invalidatePrescriptionMutationQueries(
  queryClient,
  { prescriptionId, patientId } = {},
) {
  const tasks = [];
  tasks.push(invalidateQueryKeys(queryClient, [
    nursingKeys.medicationAdministrationsAll(),
    nursingKeys.medicationAdministrationHistoryAll(),
    nursingKeys.patientMarAll(),
    nursingKeys.prnOrdersAll(),
    nursingKeys.marGridAll(),
    nursingKeys.pendingDispensingAll(),
    nursingKeys.readyForAdminAll(),
    nursingKeys.medicationsDueNow(),
    nursingKeys.medicationsOverdue(),
  ]));

  if (prescriptionId) {
    tasks.push(invalidateQueryKeys(queryClient, [prescriptionKeys.detail(prescriptionId)]));
  }

  if (patientId) {
    tasks.push(invalidateQueryKeys(queryClient, [
      prescriptionKeys.list(patientId),
      prescriptionKeys.active(patientId),
    ]));
    tasks.push(invalidatePatientTimelineQueries(queryClient, patientId));
  } else {
    tasks.push(queryClient.invalidateQueries({ queryKey: prescriptionKeys.all }));
  }

  return Promise.all(tasks);
}

/**
 * Update a prescription (partial update)
 */
export function useUpdatePrescription() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ prescriptionId, data }) => {
      return updatePrescription(prescriptionId, data);
    },
    onSuccess: (data, variables) => {
      const prescriptionId = normalizeIdentifier(variables?.prescriptionId ?? data?.id);
      const patientId = resolvePrescriptionPatientId(queryClient, {
        prescriptionId,
        sources: [data, variables],
      });

      if (prescriptionId) {
        queryClient.setQueryData(prescriptionKeys.detail(prescriptionId), data);
      }

      void invalidatePrescriptionMutationQueries(queryClient, { prescriptionId, patientId });
      toast.success('Prescription updated');
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to update prescription');
    },
  });
}

/**
 * Discontinue a prescription
 */
export function useDiscontinuePrescription() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ prescriptionId, reason }) => {
      return discontinuePrescription(prescriptionId, { reason });
    },
    onSuccess: (data, variables) => {
      const prescriptionId = normalizeIdentifier(variables?.prescriptionId ?? data?.id);
      const patientId = resolvePrescriptionPatientId(queryClient, {
        prescriptionId,
        sources: [data, variables],
      });

      if (prescriptionId) {
        queryClient.setQueryData(prescriptionKeys.detail(prescriptionId), data);
      }

      void invalidatePrescriptionMutationQueries(queryClient, { prescriptionId, patientId });
      toast.success('Prescription discontinued');
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to discontinue prescription');
    },
  });
}

/**
 * Put a prescription on hold
 */
export function useHoldPrescription() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ prescriptionId, reason }) => {
      return holdPrescription(prescriptionId, { reason });
    },
    onSuccess: (data, variables) => {
      const prescriptionId = normalizeIdentifier(variables?.prescriptionId ?? data?.id);
      const patientId = resolvePrescriptionPatientId(queryClient, {
        prescriptionId,
        sources: [data, variables],
      });

      if (prescriptionId) {
        queryClient.setQueryData(prescriptionKeys.detail(prescriptionId), data);
      }

      void invalidatePrescriptionMutationQueries(queryClient, { prescriptionId, patientId });
      toast.success('Prescription put on hold');
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to hold prescription');
    },
  });
}

/**
 * Resume a prescription that was on hold
 */
export function useResumePrescription() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ prescriptionId }) => {
      return resumePrescription(prescriptionId);
    },
    onSuccess: (data, variables) => {
      const prescriptionId = normalizeIdentifier(variables?.prescriptionId ?? data?.id);
      const patientId = resolvePrescriptionPatientId(queryClient, {
        prescriptionId,
        sources: [data, variables],
      });

      if (prescriptionId) {
        queryClient.setQueryData(prescriptionKeys.detail(prescriptionId), data);
      }

      void invalidatePrescriptionMutationQueries(queryClient, { prescriptionId, patientId });
      toast.success('Prescription resumed');
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to resume prescription');
    },
  });
}

/**
 * Renew a prescription (create new with same details)
 */
export function useRenewPrescription() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ prescriptionId, duration_days, instructions }) => {
      if (isRustV2ApiMode()) {
        throw new Error('Renewal is not available for this prescription. Create a new prescription from the current care context.');
      }
      return apiClient.post(`/clinical-notes/prescriptions/${prescriptionId}/renew/`, {
        duration_days,
        instructions,
      });
    },
    onSuccess: (data, variables) => {
      const prescriptionId = normalizeIdentifier(data?.id ?? variables?.prescriptionId);
      const patientId = resolvePrescriptionPatientId(queryClient, {
        prescriptionId,
        sources: [data, variables],
      });

      if (prescriptionId) {
        queryClient.setQueryData(prescriptionKeys.detail(prescriptionId), data);
      }

      void invalidatePrescriptionMutationQueries(queryClient, { prescriptionId, patientId });
      toast.success('Prescription renewed');
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to renew prescription');
    },
  });
}

/**
 * Fetch a single prescription by ID
 */
export async function fetchPrescription(prescriptionId, options = {}) {
  if (isRustV2ApiMode()) {
    try {
      const response = await v2Api.getClinicalPrescriptionById(
        { id: prescriptionId },
        { signal: options.signal },
      );
      return normalizePrescriptionResponse(response?.data);
    } catch (error) {
      rethrowAbortError(error);
      throw new Error(handleV2ApiError(error, 'Failed to fetch prescription'));
    }
  }
  return apiClient.get(`/clinical-notes/prescriptions/${prescriptionId}/`);
}

/**
 * Fetch active prescriptions for a patient
 */
export async function fetchPatientActivePrescriptions(patientId, options = {}) {
  if (isRustV2ApiMode()) {
    try {
      const response = await v2Api.getPatientPrescriptions(
        { patient_id: patientId },
        {
          query: { limit: ACTIVE_PRESCRIPTION_LIST_LIMIT },
          signal: options.signal,
        },
      );
      return (response?.data || []).reduce((activePrescriptions, prescription) => {
        if (prescription.status === 'active') {
          activePrescriptions.push(normalizePrescriptionResponse(prescription));
        }
        return activePrescriptions;
      }, []);
    } catch (error) {
      rethrowAbortError(error);
      throw new Error(handleV2ApiError(error, 'Failed to fetch active prescriptions'));
    }
  }
  return apiClient.get(`/clinical-notes/prescriptions/patient_active/?patient=${patientId}`);
}
