import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { clinicalNotesApi } from '@/lib/api/clinical-notes';

// Query keys
export const clinicalNotesKeys = {
  all: ['clinical-notes'],
  templates: () => [...clinicalNotesKeys.all, 'templates'],
  template: (id) => [...clinicalNotesKeys.templates(), id],
  availableTemplates: () => [...clinicalNotesKeys.templates(), 'available'],
  myTemplates: () => [...clinicalNotesKeys.templates(), 'mine'],
  templateCategories: () => [...clinicalNotesKeys.templates(), 'categories'],
  entries: () => [...clinicalNotesKeys.all, 'entries'],
  entry: (id) => [...clinicalNotesKeys.entries(), id],
  entriesByEncounter: (encounterId) => [...clinicalNotesKeys.entries(), 'encounter', encounterId],
};

/**
 * Get note templates with optional filtering
 * @param {Object} filters - Query parameters for filtering
 * @returns {Object} Query result
 */
export function useNoteTemplates(filters = {}) {
  return useQuery({
    queryKey: [...clinicalNotesKeys.templates(), filters],
    queryFn: () => clinicalNotesApi.getNoteTemplates(filters),
  });
}

/**
 * Get active note templates
 * @returns {Object} Query result
 */
export function useActiveNoteTemplates() {
  return useQuery({
    queryKey: [...clinicalNotesKeys.templates(), { active: true }],
    queryFn: () => clinicalNotesApi.getActiveNoteTemplates(),
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
    queryFn: () => clinicalNotesApi.getNoteTemplate(id),
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
    onSuccess: () => {
      // Invalidate the templates list query to refetch
      queryClient.invalidateQueries({ queryKey: clinicalNotesKeys.templates() });
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
 * @returns {Object} Query result
 */
export function useAvailableNoteTemplates() {
  return useQuery({
    queryKey: clinicalNotesKeys.availableTemplates(),
    queryFn: () => clinicalNotesApi.getAvailableTemplates(),
  });
}

/**
 * Get templates created by the current user
 * @returns {Object} Query result
 */
export function useMyNoteTemplates() {
  return useQuery({
    queryKey: clinicalNotesKeys.myTemplates(),
    queryFn: () => clinicalNotesApi.getMyTemplates(),
  });
}

/**
 * Get available template categories
 * @returns {Object} Query result
 */
export function useTemplateCategories() {
  return useQuery({
    queryKey: clinicalNotesKeys.templateCategories(),
    queryFn: () => clinicalNotesApi.getTemplateCategories(),
    staleTime: 1000 * 60 * 60, // Categories don't change often, cache for 1 hour
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
    queryKey: [...clinicalNotesKeys.entries(), filters],
    queryFn: () => clinicalNotesApi.getNoteEntries(filters),
  });
}

/**
 * Get note entries for an encounter
 * @param {string} encounterId - Encounter ID
 * @returns {Object} Query result
 */
export function useNoteEntriesForEncounter(encounterId) {
  return useQuery({
    queryKey: clinicalNotesKeys.entriesByEncounter(encounterId),
    queryFn: () => clinicalNotesApi.getNoteEntriesForEncounter(encounterId),
    enabled: !!encounterId, // Only run the query if we have an encounter ID
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
    queryFn: () => clinicalNotesApi.getNoteEntry(id),
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
    onSuccess: (data) => {
      // Invalidate the entries list query to refetch
      queryClient.invalidateQueries({ queryKey: clinicalNotesKeys.entries() });
      
      // If the entry is associated with an encounter, invalidate that specific query
      if (data.encounter_id) {
        queryClient.invalidateQueries({ 
          queryKey: clinicalNotesKeys.entriesByEncounter(data.encounter_id) 
        });
      }
    },
  });
}