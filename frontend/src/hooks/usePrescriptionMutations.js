import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { timelineKeys } from './useTimelineQueries';
import { toast } from 'sonner';
import { createKeyFactory, keyWith } from '@/shared/lib/queryKeys';

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
      // Invalidate timeline and prescription queries
      queryClient.invalidateQueries({ queryKey: timelineKeys.all });
      queryClient.invalidateQueries({ queryKey: prescriptionKeys.all });
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
      queryClient.invalidateQueries({ queryKey: timelineKeys.all });
      queryClient.invalidateQueries({ queryKey: prescriptionKeys.all });
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
      queryClient.invalidateQueries({ queryKey: timelineKeys.all });
      queryClient.invalidateQueries({ queryKey: prescriptionKeys.all });
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
      queryClient.invalidateQueries({ queryKey: timelineKeys.all });
      queryClient.invalidateQueries({ queryKey: prescriptionKeys.all });
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
      queryClient.invalidateQueries({ queryKey: timelineKeys.all });
      queryClient.invalidateQueries({ queryKey: prescriptionKeys.all });
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
