import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { clinicalNotesApi } from '@/features/clinical-notes/api';
import { immutableMetadataQueryOptions } from '@/lib/react-query';
import { createKeyFactory, keyWith } from '@/shared/lib/queryKeys';
import { invalidateQueryKeys } from '@/shared/lib/queryInvalidation';
import { invalidatePatientTimelineQueries } from './useTimelineQueries';
import { emitOnboardingEvent } from '@/features/onboarding';

// Query keys
const clinicalNotesKeyFactory = createKeyFactory('clinical-notes');

export const clinicalNotesKeys = {
  all: clinicalNotesKeyFactory.all,
  templates: () => keyWith('clinical-notes', 'templates'),
  template: (id) => keyWith('clinical-notes', 'templates', id),
  availableTemplates: () => keyWith('clinical-notes', 'templates', 'available'),
  myTemplates: () => keyWith('clinical-notes', 'templates', 'mine'),
  templateCategories: () => keyWith('clinical-notes', 'templates', 'categories'),
  entries: () => keyWith('clinical-notes', 'entries'),
  entriesList: (filters) => keyWith('clinical-notes', 'entries', filters),
  entry: (id) => keyWith('clinical-notes', 'entries', id),
  entrySections: (id) => keyWith('clinical-notes', 'entries', id, 'sections'),
  entriesByEncounter: (encounterId) => keyWith('clinical-notes', 'entries', 'encounter', encounterId),
  entryHistory: (id) => keyWith('clinical-notes', 'entries', id, 'history'),
  entryVersion: (id, version) => keyWith('clinical-notes', 'entries', id, 'version', version),
};

function normalizeIdentifier(value) {
  if (!value) return null;
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'object') {
    return value.id ?? value.uuid ?? null;
  }
  return null;
}

function getCachedNoteEntry(queryClient, entryId) {
  if (!entryId) return null;
  return queryClient.getQueryData(clinicalNotesKeys.entry(entryId));
}

function resolveNotePatientId(queryClient, { entryId, patientId, sources = [] } = {}) {
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

  if (entryId) {
    const cachedEntry = getCachedNoteEntry(queryClient, entryId);
    if (cachedEntry) {
      candidates.push(
        cachedEntry.patient,
        cachedEntry.patient_id,
        cachedEntry.patientId,
        cachedEntry.patient?.id,
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

function resolveNoteEncounterId(queryClient, { entryId, encounterId, sources = [] } = {}) {
  const candidates = [];

  if (encounterId) {
    candidates.push(encounterId);
  }

  for (const source of sources) {
    if (!source) continue;
    candidates.push(source);

    if (typeof source === 'object') {
      candidates.push(source.encounter, source.encounter_id, source.encounterId, source.encounter?.id);
    }
  }

  if (entryId) {
    const cachedEntry = getCachedNoteEntry(queryClient, entryId);
    if (cachedEntry) {
      candidates.push(
        cachedEntry.encounter,
        cachedEntry.encounter_id,
        cachedEntry.encounterId,
        cachedEntry.encounter?.id,
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

export function invalidateClinicalNoteMutationQueries(
  queryClient,
  { entryId, patientId, encounterId } = {},
) {
  const tasks = [queryClient.invalidateQueries({ queryKey: clinicalNotesKeys.entries() })];

  if (entryId) {
    tasks.push(invalidateQueryKeys(queryClient, [clinicalNotesKeys.entry(entryId)]));
  }

  if (encounterId) {
    tasks.push(invalidateQueryKeys(queryClient, [clinicalNotesKeys.entriesByEncounter(encounterId)]));
  }

  if (patientId) {
    tasks.push(invalidatePatientTimelineQueries(queryClient, patientId));
  }

  return Promise.all(tasks);
}

/**
 * Get note templates with optional filtering
 * @param {Object} filters - Query parameters for filtering
 * @returns {Object} Query result
 */
export function useNoteTemplates(filters = {}) {
  return useQuery({
    queryKey: keyWith('clinical-notes', 'templates', filters),
    queryFn: ({ signal }) => clinicalNotesApi.getNoteTemplates(filters, { signal }),
  });
}

/**
 * Get active note templates
 * @returns {Object} Query result
 */
export function useActiveNoteTemplates(options = {}) {
  const { enabled = true, ...filters } = options;
  return useQuery({
    queryKey: keyWith('clinical-notes', 'templates', { active: true, ...filters }),
    queryFn: ({ signal }) => clinicalNotesApi.getActiveNoteTemplates(filters, { signal }),
    enabled,
  });
}

/**
 * Get a single note template by ID
 * @param {string} id - Note template ID
 * @returns {Object} Query result
 */
export function useNoteTemplate(id) {
  return useQuery({
    queryKey: clinicalNotesKeys.template(id),
    queryFn: ({ signal }) => clinicalNotesApi.getNoteTemplate(id, { signal }),
    enabled: !!id, // Only run the query if we have an ID
  });
}

/**
 * Create a new note template
 * @returns {Object} Mutation result
 */
export function useCreateNoteTemplate() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data) => clinicalNotesApi.createNoteTemplate(data),
    onSuccess: (data, variables) => {
      // Invalidate the templates list query to refetch
      queryClient.invalidateQueries({ queryKey: clinicalNotesKeys.templates() });

      const sectionsFromResponse = Array.isArray(data?.structure)
        ? data.structure
        : data?.structure?.sections;
      const sectionsFromRequest = Array.isArray(variables?.structure)
        ? variables.structure
        : variables?.structure?.sections;
      const sectionCount = Array.isArray(sectionsFromResponse)
        ? sectionsFromResponse.length
        : Array.isArray(sectionsFromRequest)
        ? sectionsFromRequest.length
        : 0;

      emitOnboardingEvent('templates.note.created', {
        success: true,
        template_id: data?.id || null,
        section_count: sectionCount,
      });
    },
  });
}

/**
 * Update an existing note template
 * @returns {Object} Mutation result
 */
export function useUpdateNoteTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => clinicalNotesApi.updateNoteTemplate(id, data),

    // Optimistic update - immediately update UI before server responds
    onMutate: async ({ id, data }) => {
      // Cancel any outgoing refetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: clinicalNotesKeys.template(id) });

      // Snapshot the previous value
      const previousNoteTemplate = queryClient.getQueryData(clinicalNotesKeys.template(id));

      // Optimistically update to the new value
      queryClient.setQueryData(clinicalNotesKeys.template(id), (old) => ({
        ...old,
        ...data,
      }));

      // Return context with the previous value for potential rollback
      return { previousNoteTemplate, id };
    },

    // If mutation fails, rollback to the previous value
    onError: (err, variables, context) => {
      if (context?.previousNoteTemplate) {
        queryClient.setQueryData(
          clinicalNotesKeys.template(context.id),
          context.previousNoteTemplate
        );
      }
    },

    // Always refetch after error or success to ensure consistency
    onSettled: (data, error, variables) => {
      queryClient.invalidateQueries({
        queryKey: clinicalNotesKeys.template(variables.id)
      });
      queryClient.invalidateQueries({
        queryKey: clinicalNotesKeys.templates()
      });
    },
  });
}

/**
 * Delete a note template
 * @returns {Object} Mutation result
 */
export function useDeleteNoteTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => clinicalNotesApi.deleteNoteTemplate(id),
    onSuccess: (data, variables) => {
      // Invalidate the template detail query
      queryClient.invalidateQueries({
        queryKey: clinicalNotesKeys.template(variables)
      });
      // Also invalidate the list to reflect changes
      queryClient.invalidateQueries({
        queryKey: clinicalNotesKeys.templates()
      });
    },
  });
}

/**
 * Get available templates for the current user (for note creation)
 * Only returns active templates that the user can see
 * @param {Object} options - Query options
 * @param {boolean} options.enabled - Enable/disable the query (for lazy loading)
 * @returns {Object} Query result
 */
export function useAvailableNoteTemplates(options = {}) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: clinicalNotesKeys.availableTemplates(),
    queryFn: ({ signal }) => clinicalNotesApi.getAvailableTemplates({ signal }),
    enabled,
  });
}

/**
 * Get templates created by the current user
 * @returns {Object} Query result
 */
export function useMyNoteTemplates() {
  return useQuery({
    queryKey: clinicalNotesKeys.myTemplates(),
    queryFn: ({ signal }) => clinicalNotesApi.getMyTemplates({ signal }),
  });
}

/**
 * Get available template categories
 * @returns {Object} Query result
 */
export function useTemplateCategories() {
  return useQuery({
    queryKey: clinicalNotesKeys.templateCategories(),
    queryFn: ({ signal }) => clinicalNotesApi.getTemplateCategories({ signal }),
    ...immutableMetadataQueryOptions(),
  });
}

/**
 * Duplicate an existing template
 * @returns {Object} Mutation result
 */
export function useDuplicateNoteTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) => clinicalNotesApi.duplicateTemplate(id),
    onSuccess: () => {
      // Invalidate all template queries to show the new copy
      queryClient.invalidateQueries({ queryKey: clinicalNotesKeys.templates() });
      queryClient.invalidateQueries({ queryKey: clinicalNotesKeys.myTemplates() });
    },
  });
}

/**
 * Get note entries with optional filtering
 * @param {Object} filters - Query parameters for filtering
 * @returns {Object} Query result
 */
export function useNoteEntries(filters = {}) {
  return useQuery({
    queryKey: clinicalNotesKeys.entriesList(filters),
    queryFn: ({ signal }) => clinicalNotesApi.getNoteEntries(filters, { signal }),
  });
}

/**
 * Get note entries for an encounter
 * @param {string} encounterId - Encounter ID
 * @returns {Object} Query result
 */
export function useNoteEntriesForEncounter(encounterId, options = {}) {
  const { enabled = true, ...filters } = options;
  return useQuery({
    queryKey: keyWith('clinical-notes', 'entries', 'encounter', encounterId, { filters }),
    queryFn: ({ signal }) => clinicalNotesApi.getNoteEntriesForEncounter(encounterId, filters, { signal }),
    enabled: !!encounterId && enabled, // Only run the query if we have an encounter ID
  });
}

/**
 * Get a single note entry by ID
 * @param {string} id - Note entry ID
 * @returns {Object} Query result
 */
export function useNoteEntry(id) {
  return useQuery({
    queryKey: clinicalNotesKeys.entry(id),
    queryFn: ({ signal }) => clinicalNotesApi.getNoteEntry(id, { signal }),
    enabled: !!id, // Only run the query if we have an ID
  });
}

/**
 * Create a new note entry
 * @returns {Object} Mutation result
 */
export function useCreateNoteEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data) => clinicalNotesApi.createNoteEntry(data),
    onSuccess: (data, variables) => {
      const entryId = normalizeIdentifier(data?.id);
      const patientId = resolveNotePatientId(queryClient, {
        entryId,
        sources: [data, variables],
      });
      const encounterId = resolveNoteEncounterId(queryClient, {
        entryId,
        sources: [data, variables],
      });

      if (entryId) {
        queryClient.setQueryData(clinicalNotesKeys.entry(entryId), data);
      }

      void invalidateClinicalNoteMutationQueries(queryClient, {
        entryId,
        patientId,
        encounterId,
      });

      emitOnboardingEvent('chronicle.note_created', {
        success: true,
        note_id: data?.id || null,
        template_id: data?.template || variables?.template || null,
        patient_id: data?.patient || variables?.patient || null,
      });
    },
  });
}

/**
 * Get available sections for copying from a note entry
 * @param {string} id - Note entry ID
 * @param {Object} options - Query options
 * @returns {Object} Query result with sections array
 */
export function useNoteEntrySections(id, options = {}) {
  return useQuery({
    queryKey: clinicalNotesKeys.entrySections(id),
    queryFn: ({ signal }) => clinicalNotesApi.getNoteEntrySections(id, { signal }),
    enabled: !!id && options.enabled !== false,
    ...options,
  });
}

/**
 * Clone a note entry with selective section copying
 * @returns {Object} Mutation result
 */
export function useCloneNoteEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }) => clinicalNotesApi.cloneNoteEntry(id, data),
    onSuccess: (data) => {
      const entryId = normalizeIdentifier(data?.id);
      const patientId = resolveNotePatientId(queryClient, {
        entryId,
        sources: [data],
      });
      const encounterId = resolveNoteEncounterId(queryClient, {
        entryId,
        sources: [data],
      });

      if (entryId) {
        queryClient.setQueryData(clinicalNotesKeys.entry(entryId), data);
      }

      void invalidateClinicalNoteMutationQueries(queryClient, {
        entryId,
        patientId,
        encounterId,
      });
    },
  });
}

/**
 * Update a note entry with version tracking
 * @returns {Object} Mutation result
 */
export function useUpdateNoteEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data, editReason }) =>
      clinicalNotesApi.updateNoteEntry(id, data, editReason),
    onSuccess: (data, variables) => {
      const entryId = normalizeIdentifier(variables?.id);
      const patientId = resolveNotePatientId(queryClient, {
        entryId,
        sources: [data],
      });
      const encounterId = resolveNoteEncounterId(queryClient, {
        entryId,
        sources: [data],
      });

      queryClient.setQueryData(clinicalNotesKeys.entry(entryId), data);
      void invalidateQueryKeys(queryClient, [clinicalNotesKeys.entryHistory(entryId)]);
      void invalidateClinicalNoteMutationQueries(queryClient, {
        entryId,
        patientId,
        encounterId,
      });
    },
  });
}

/**
 * Get version history for a note entry
 * @param {string} id - Note entry ID
 * @param {Object} options - Query options
 * @returns {Object} Query result with version history
 */
export function useNoteEntryHistory(id, options = {}) {
  return useQuery({
    queryKey: clinicalNotesKeys.entryHistory(id),
    queryFn: ({ signal }) => clinicalNotesApi.getNoteEntryHistory(id, { signal }),
    enabled: !!id && options.enabled !== false,
    ...options,
  });
}

/**
 * Get a specific version of a note entry
 * @param {string} id - Note entry ID
 * @param {number} versionNumber - Version number
 * @param {Object} options - Query options
 * @returns {Object} Query result with version data
 */
export function useNoteEntryVersion(id, versionNumber, options = {}) {
  return useQuery({
    queryKey: clinicalNotesKeys.entryVersion(id, versionNumber),
    queryFn: ({ signal }) => clinicalNotesApi.getNoteEntryVersion(id, versionNumber, { signal }),
    enabled: !!id && !!versionNumber && options.enabled !== false,
    ...options,
  });
}

/**
 * Compare two versions of a note entry
 * @param {string} id - Note entry ID
 * @param {number} versionA - First version number (0 for current)
 * @param {number} versionB - Second version number (0 for current)
 * @param {Object} options - Query options
 * @returns {Object} Query result with comparison data
 */
export function useCompareNoteVersions(id, versionA, versionB, options = {}) {
  return useQuery({
    queryKey: [...clinicalNotesKeys.entry(id), 'compare', versionA, versionB],
    queryFn: ({ signal }) => clinicalNotesApi.compareNoteVersions(id, versionA, versionB, { signal }),
    enabled: !!id && versionA !== undefined && versionB !== undefined && options.enabled !== false,
    ...options,
  });
}
