import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { myPatientsApi } from '@/features/patients/api';
import { toast } from 'sonner';
import { createKeyFactory, keyWith } from '@/shared/lib/queryKeys';

// Query keys
const myPatientsKeyFactory = createKeyFactory('my-patients');

export const myPatientsKeys = {
  all: myPatientsKeyFactory.all,
  list: () => keyWith('my-patients', 'list'),
  check: (patientId) => keyWith('my-patients', 'check', patientId),
};

/**
 * Get user's personal patient list
 * @param {Object} options - Query options
 * @param {boolean} options.enabled - Whether the query should run (default: true)
 * @returns {Object} Query result with patient list
 */
export function useMyPatients(options = {}) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: myPatientsKeys.list(),
    queryFn: () => myPatientsApi.getMyPatients(),
    staleTime: 2 * 60 * 1000, // 2 minutes
    enabled,
  });
}

/**
 * Check if a specific patient is in user's list
 * @param {string} patientId - Patient ID to check
 * @returns {Object} Query result with { in_list: boolean }
 */
export function useCheckPatientInList(patientId) {
  return useQuery({
    queryKey: myPatientsKeys.check(patientId),
    queryFn: () => myPatientsApi.checkPatient(patientId),
    enabled: !!patientId,
    staleTime: 30 * 1000, // 30 seconds
  });
}

/**
 * Add a patient to user's list
 * @returns {Object} Mutation result
 */
export function useAddToMyPatients() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ patientId, options = {} }) => myPatientsApi.addPatient(patientId, options),
    onSuccess: (data, variables) => {
      // Invalidate the list and check queries
      queryClient.invalidateQueries({ queryKey: myPatientsKeys.list() });
      queryClient.setQueryData(myPatientsKeys.check(variables.patientId), { in_list: true });
      toast.success('Patient added to your list');
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to add patient to list');
    },
  });
}

/**
 * Remove a patient from user's list by patient ID
 * @returns {Object} Mutation result
 */
export function useRemoveFromMyPatients() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (patientId) => myPatientsApi.removePatient(patientId),
    onMutate: async (patientId) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: myPatientsKeys.list() });

      // Snapshot previous value
      const previousList = queryClient.getQueryData(myPatientsKeys.list());

      // Optimistically remove from list
      if (previousList) {
        queryClient.setQueryData(myPatientsKeys.list(), (old) =>
          Array.isArray(old)
            ? old.filter(entry => entry.patient !== patientId && entry.patient_details?.id !== patientId)
            : old?.results
              ? { ...old, results: old.results.filter(entry => entry.patient !== patientId && entry.patient_details?.id !== patientId) }
              : old
        );
      }

      // Update check query
      queryClient.setQueryData(myPatientsKeys.check(patientId), { in_list: false });

      return { previousList, patientId };
    },
    onError: (error, patientId, context) => {
      // Rollback on error
      if (context?.previousList) {
        queryClient.setQueryData(myPatientsKeys.list(), context.previousList);
      }
      queryClient.setQueryData(myPatientsKeys.check(patientId), { in_list: true });
      toast.error(error.message || 'Failed to remove patient from list');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: myPatientsKeys.list() });
      toast.success('Patient removed from your list');
    },
  });
}

/**
 * Remove a list entry by entry ID
 * @returns {Object} Mutation result
 */
export function useRemoveMyPatientEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (entryId) => myPatientsApi.removeEntry(entryId),
    onMutate: async (entryId) => {
      await queryClient.cancelQueries({ queryKey: myPatientsKeys.list() });
      const previousList = queryClient.getQueryData(myPatientsKeys.list());

      // Optimistically remove from list
      if (previousList) {
        queryClient.setQueryData(myPatientsKeys.list(), (old) =>
          Array.isArray(old)
            ? old.filter(entry => entry.id !== entryId)
            : old?.results
              ? { ...old, results: old.results.filter(entry => entry.id !== entryId) }
              : old
        );
      }

      return { previousList, entryId };
    },
    onError: (error, entryId, context) => {
      if (context?.previousList) {
        queryClient.setQueryData(myPatientsKeys.list(), context.previousList);
      }
      toast.error(error.message || 'Failed to remove patient from list');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: myPatientsKeys.list() });
      toast.success('Patient removed from your list');
    },
  });
}

/**
 * Toggle pin status for a patient in the list
 * @returns {Object} Mutation result
 */
export function useToggleMyPatientPin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (entryId) => myPatientsApi.togglePin(entryId),
    onMutate: async (entryId) => {
      await queryClient.cancelQueries({ queryKey: myPatientsKeys.list() });
      const previousList = queryClient.getQueryData(myPatientsKeys.list());

      // Optimistically toggle pin
      if (previousList) {
        queryClient.setQueryData(myPatientsKeys.list(), (old) => {
          const updateEntry = (entry) =>
            entry.id === entryId ? { ...entry, is_pinned: !entry.is_pinned } : entry;

          return Array.isArray(old)
            ? old.map(updateEntry)
            : old?.results
              ? { ...old, results: old.results.map(updateEntry) }
              : old;
        });
      }

      return { previousList };
    },
    onError: (error, entryId, context) => {
      if (context?.previousList) {
        queryClient.setQueryData(myPatientsKeys.list(), context.previousList);
      }
      toast.error(error.message || 'Failed to update pin status');
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: myPatientsKeys.list() });
      toast.success(data.is_pinned ? 'Patient pinned' : 'Patient unpinned');
    },
  });
}

/**
 * Update notes for a patient in the list
 * @returns {Object} Mutation result
 */
export function useUpdateMyPatientNotes() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ entryId, notes }) => myPatientsApi.updateNotes(entryId, notes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: myPatientsKeys.list() });
      toast.success('Notes updated');
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to update notes');
    },
  });
}
