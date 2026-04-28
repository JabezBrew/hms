import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from 'sonner';
import { createKeyFactory, keyWith } from '@/shared/lib/queryKeys';
import { invalidateQueryKeys } from '@/shared/lib/queryInvalidation';
import { invalidatePatientTimelineQueries } from './useTimelineQueries';

/**
 * Prescription mutation hooks for managing prescription lifecycle
 */

// Query keys for prescriptions
const prescriptionKeyFactory = createKeyFactory('prescriptions');

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
    candidates.push(source);

    if (typeof source === 'object') {
      candidates.push(source.patient, source.patient_id, source.patientId, source.patient?.id);
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
      return apiClient.patch(`/clinical-notes/prescriptions/${prescriptionId}/`, data);
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
      return apiClient.post(`/clinical-notes/prescriptions/${prescriptionId}/discontinue/`, {
        reason,
      });
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
      return apiClient.post(`/clinical-notes/prescriptions/${prescriptionId}/hold/`, {
        reason,
      });
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
      return apiClient.post(`/clinical-notes/prescriptions/${prescriptionId}/resume/`, {});
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
export async function fetchPrescription(prescriptionId) {
  return apiClient.get(`/clinical-notes/prescriptions/${prescriptionId}/`);
}

/**
 * Fetch active prescriptions for a patient
 */
export async function fetchPatientActivePrescriptions(patientId) {
  return apiClient.get(`/clinical-notes/prescriptions/patient_active/?patient=${patientId}`);
}
