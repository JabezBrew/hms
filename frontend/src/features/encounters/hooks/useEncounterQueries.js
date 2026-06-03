import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { encountersApi } from '@/features/encounters/api';
import { useSearchQuery } from '@/hooks/useSearchQuery';
import { createKeyFactory } from '@/shared/lib/queryKeys';
import { invalidateQueryKeys } from '@/shared/lib/queryInvalidation';
import { hashQueryValue } from '@/shared/lib/privateQueryKey';

// Query keys
const baseKeys = createKeyFactory('encounters');

export const encounterKeys = {
  ...baseKeys,
  forPatient: (patientId) => [...encounterKeys.all, 'forPatient', hashQueryValue(String(patientId || 'none'))],
  listFingerprint: (fingerprint) => [...encounterKeys.lists(), fingerprint],
  patients: () => [...encounterKeys.all, 'patients'],
  practitioners: () => [...encounterKeys.all, 'practitioners'],
};

function fingerprintFilters(filters = {}) {
  const stable = JSON.stringify(Object.keys(filters)
    .sort()
    .reduce((accumulator, key) => {
      accumulator[key] = filters[key];
      return accumulator;
    }, {}));
  let hash = 2166136261;
  for (let index = 0; index < stable.length; index += 1) {
    hash ^= stable.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash.toString(36);
}

function normalizeIdentifier(value) {
  if (!value) return null;
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'object') {
    return value.id ?? value.uuid ?? null;
  }
  return null;
}

export function resolveEncounterPatientId(queryClient, { encounterId, patientId, sources = [] } = {}) {
  const candidates = [];

  if (patientId) {
    candidates.push(patientId);
  }

  for (const source of sources) {
    if (!source) continue;
    candidates.push(source);

    if (typeof source === 'object') {
      candidates.push(
        source.patient_id,
        source.patientId,
        source.patient,
        source.patient?.id,
      );
    }
  }

  if (encounterId) {
    const cachedEncounter = queryClient.getQueryData(encounterKeys.detail(encounterId));
    if (cachedEncounter) {
      candidates.push(
        cachedEncounter.patient_id,
        cachedEncounter.patientId,
        cachedEncounter.patient,
        cachedEncounter.patient?.id,
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

export function invalidateEncounterMutationQueries(queryClient, { encounterId, patientId } = {}) {
  const queryKeys = [encounterKeys.lists()];

  if (encounterId) {
    queryKeys.push(encounterKeys.detail(encounterId));
  }

  if (patientId) {
    queryKeys.push(encounterKeys.forPatient(patientId));
  }

  return invalidateQueryKeys(queryClient, queryKeys);
}

/**
 * Get encounters list with optional filtering
 * @param {Object} filters - Query parameters for filtering
 * @returns {Object} Query result
 */
export function useEncounters(filters = {}) {
  return useQuery({
    queryKey: encounterKeys.listFingerprint(fingerprintFilters(filters)),
    queryFn: ({ signal }) => encountersApi.getEncounters(filters, { signal }),
    staleTime: 60 * 1000, // 60 seconds - matches backend cache timeout
  });
}

/**
 * Get a single encounter by ID
 * @param {string} id - Encounter ID
 * @returns {Object} Query result
 */
export function useEncounter(id) {
  return useQuery({
    queryKey: encounterKeys.detail(id),
    queryFn: ({ signal }) => encountersApi.getEncounter(id, { signal }),
    enabled: !!id, // Only run the query if we have an ID
    staleTime: 60 * 1000, // 60 seconds
  });
}

/**
 * Get all encounters for a specific patient
 * @param {string} patientId - Patient ID
 * @param {Object} options - Query options
 * @returns {Object} Query result with patient's encounters
 */
export function usePatientEncounters(patientId, options = {}) {
  return useQuery({
    queryKey: encounterKeys.forPatient(patientId),
    queryFn: ({ signal }) => encountersApi.getEncountersForPatient(patientId, { signal }),
    enabled: !!patientId,
    staleTime: 60 * 1000, // 60 seconds
    ...options,
  });
}

/**
 * Create a new encounter
 * @returns {Object} Mutation result
 */
export function useCreateEncounter() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data) => encountersApi.createEncounter(data),
    onSuccess: (data, variables) => {
      const encounterId = normalizeIdentifier(data?.id);
      const patientId = resolveEncounterPatientId(queryClient, {
        encounterId,
        sources: [data, variables],
      });

      if (encounterId) {
        queryClient.setQueryData(encounterKeys.detail(encounterId), data);
      }

      void invalidateEncounterMutationQueries(queryClient, { encounterId, patientId });
    },
  });
}

/**
 * Update an existing encounter
 * @returns {Object} Mutation result
 */
export function useUpdateEncounter() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => encountersApi.updateEncounter(id, data),

    // Optimistic update - immediately update UI before server responds
    onMutate: async ({ id, data }) => {
      // Cancel any outgoing refetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: encounterKeys.detail(id) });

      // Snapshot the previous value
      const previousEncounter = queryClient.getQueryData(encounterKeys.detail(id));

      // Optimistically update to the new value
      queryClient.setQueryData(encounterKeys.detail(id), (old) => ({
        ...old,
        ...data,
      }));

      // Return context with the previous value for potential rollback
      return { previousEncounter, id };
    },

    // If mutation fails, rollback to the previous value
    onError: (err, variables, context) => {
      if (context?.previousEncounter) {
        queryClient.setQueryData(
          encounterKeys.detail(context.id),
          context.previousEncounter
        );
      }
    },

    // Always refetch after error or success to ensure consistency
    onSettled: (data, error, variables) => {
      const encounterId = normalizeIdentifier(variables?.id);
      const patientId = resolveEncounterPatientId(queryClient, {
        encounterId,
        sources: [data, variables?.data],
      });

      void invalidateEncounterMutationQueries(queryClient, { encounterId, patientId });
    },
  });
}

/**
 * Delete an encounter
 * @returns {Object} Mutation result
 */
export function useDeleteEncounter() {
  const queryClient = useQueryClient();
  
  // Invalidation is centralized in invalidateEncounterMutationQueries so patient encounter lists and detail caches stay aligned.
  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation
  return useMutation({
    mutationFn: (id) => encountersApi.deleteEncounter(id),
    onSuccess: (data, variables) => {
      const encounterId = normalizeIdentifier(variables);
      const patientId = resolveEncounterPatientId(queryClient, {
        encounterId,
        sources: [data],
      });

      void invalidateEncounterMutationQueries(queryClient, { encounterId, patientId });
    },
  });
}

/**
 * Discharge a patient (for inpatient encounters)
 * @returns {Object} Mutation result
 */
export function useDischargePatient() {
  const queryClient = useQueryClient();
  
  // Invalidation is centralized in invalidateEncounterMutationQueries so patient encounter lists and detail caches stay aligned.
  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation
  return useMutation({
    mutationFn: ({ id, data }) => encountersApi.dischargePatient(id, data),
    onSuccess: (data, variables) => {
      const encounterId = normalizeIdentifier(variables?.id);
      const patientId = resolveEncounterPatientId(queryClient, {
        encounterId,
        sources: [data, variables?.data],
      });

      void invalidateEncounterMutationQueries(queryClient, { encounterId, patientId });
    },
  });
}

/**
 * Cancel an encounter
 * @returns {Object} Mutation result
 */
export function useCancelEncounter() {
  const queryClient = useQueryClient();
  
  // Invalidation is centralized in invalidateEncounterMutationQueries so patient encounter lists and detail caches stay aligned.
  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation
  return useMutation({
    mutationFn: (id) => encountersApi.cancelEncounter(id),
    onSuccess: (data, variables) => {
      const encounterId = normalizeIdentifier(variables);
      const patientId = resolveEncounterPatientId(queryClient, {
        encounterId,
        sources: [data],
      });

      void invalidateEncounterMutationQueries(queryClient, { encounterId, patientId });
    },
  });
}

/**
 * Search patients for encounter
 * @param {Object} options - Search options
 * @returns {Object} Search query result
 */
export function useSearchPatientsForEncounter(options = {}) {
  return useSearchQuery(
    [...encounterKeys.patients(), 'search'],
    (query, requestOptions) => encountersApi.searchPatients(query, requestOptions),
    {
      staleTime: 1 * 60 * 1000, // Search results stale after 1 minute
      ...options,
    }
  );
}

/**
 * Search practitioners for encounter
 * @param {boolean} doctorsOnly - Whether to filter for doctors only
 * @param {Object} options - Search options
 * @returns {Object} Search query result
 */
export function useSearchPractitioners(doctorsOnly = false, options = {}) {
  return useSearchQuery(
    [...encounterKeys.practitioners(), 'search', { doctorsOnly }],
    (query, requestOptions) => encountersApi.searchPractitioners(query, doctorsOnly, requestOptions),
    {
      staleTime: 5 * 60 * 1000, // Practitioners list changes less frequently
      ...options,
    }
  );
}
