/**
 * Chart Builder React Query Hooks
 *
 * Provides data fetching and mutation hooks for chart templates,
 * assignments, and entries.
 */

import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { immutableMetadataQueryOptions } from '@/lib/react-query';
import { toast } from 'sonner';
import { createKeyFactory, keyWith } from '@/shared/lib/queryKeys';
import { emitOnboardingEvent } from '@/features/onboarding';
import {
  hasQueryPrefix,
  invalidateQueriesMatching,
  invalidateQueryKeys,
} from '@/shared/lib/queryInvalidation';
import { invalidatePatientTimelineQueries } from '@/hooks/useTimelineQueries';

// =============================================================================
// Query Keys
// =============================================================================

const chartKeyFactory = createKeyFactory('charts');

export const chartKeys = {
  all: chartKeyFactory.all,
  templates: () => keyWith('charts', 'templates'),
  templateList: (filters) => keyWith('charts', 'templates', 'list', filters),
  templateDetail: (id) => keyWith('charts', 'templates', 'detail', id),
  categories: () => keyWith('charts', 'templates', 'categories'),
  intervals: () => keyWith('charts', 'templates', 'intervals'),

  assignments: () => keyWith('charts', 'assignments'),
  assignmentList: (filters) => keyWith('charts', 'assignments', 'list', filters),
  assignmentListParams: (patient, admission, encounterId, template, status, scopeType, allHistory) =>
    keyWith('charts', 'assignments', 'list', patient, admission, encounterId, template, status, scopeType, allHistory),
  assignmentPaginatedList: (patient, admission, encounterId, template, status, scopeType, allHistory, ordering, page, pageSize) =>
    keyWith('charts', 'assignments', 'paginated-list', patient, admission, encounterId, template, status, scopeType, allHistory, ordering, page, pageSize),
  assignmentDetail: (id) => keyWith('charts', 'assignments', 'detail', id),
  assignmentsByPatient: (patientId, status, admissionId, encounterId, scopeType, allHistory) =>
    keyWith('charts', 'assignments', 'patient', patientId, status, admissionId, encounterId, scopeType, allHistory),

  entries: () => keyWith('charts', 'entries'),
  entryList: (filters) => keyWith('charts', 'entries', 'list', filters),
  entryDetail: (id) => keyWith('charts', 'entries', 'detail', id),
  entrySummary: (assignmentId, startDate, endDate) => keyWith('charts', 'entries', 'summary', assignmentId, startDate, endDate),
  entryTrends: (assignmentId, fieldKey, component, startDate, endDate, limit) =>
    keyWith('charts', 'entries', 'trends', assignmentId, fieldKey, component, startDate, endDate, limit),
  entriesByPatient: (patientId, templateId, admissionId, encounterId, allHistory) =>
    keyWith('charts', 'entries', 'patient', patientId, templateId, admissionId, encounterId, allHistory),
};

function normalizeIdentifier(value) {
  if (!value) return null;
  if (typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'object') {
    return value.id ?? value.uuid ?? null;
  }
  return null;
}

function getCachedAssignment(queryClient, assignmentId) {
  if (!assignmentId) return null;
  return queryClient.getQueryData(chartKeys.assignmentDetail(assignmentId));
}

function getCachedEntry(queryClient, entryId) {
  if (!entryId) return null;
  return queryClient.getQueryData(chartKeys.entryDetail(entryId));
}

function resolveChartAssignmentId(queryClient, { assignmentId, entryId, sources = [] } = {}) {
  const candidates = [];

  if (assignmentId) {
    candidates.push(assignmentId);
  }

  for (const source of sources) {
    if (!source) continue;
    candidates.push(source);

    if (typeof source === 'object') {
      candidates.push(source.assignment, source.assignmentId, source.assignment_id);
    }
  }

  if (entryId) {
    const cachedEntry = getCachedEntry(queryClient, entryId);
    if (cachedEntry) {
      candidates.push(
        cachedEntry.assignment,
        cachedEntry.assignmentId,
        cachedEntry.assignment_id,
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

function resolveChartPatientId(queryClient, { patientId, assignmentId, sources = [] } = {}) {
  const candidates = [];

  if (patientId) {
    candidates.push(patientId);
  }

  for (const source of sources) {
    if (!source) continue;
    candidates.push(source);

    if (typeof source === 'object') {
      candidates.push(
        source.patient,
        source.patientId,
        source.patient_id,
        source.patient?.id,
      );
    }
  }

  if (assignmentId) {
    const cachedAssignment = getCachedAssignment(queryClient, assignmentId);
    if (cachedAssignment) {
      candidates.push(
        cachedAssignment.patient,
        cachedAssignment.patientId,
        cachedAssignment.patient_id,
        cachedAssignment.patient?.id,
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

export function invalidateChartAssignmentMutationQueries(queryClient, { assignmentId, patientId } = {}) {
  const tasks = [];

  if (assignmentId) {
    tasks.push(invalidateQueryKeys(queryClient, [chartKeys.assignmentDetail(assignmentId)]));
  }

  if (patientId) {
    tasks.push(invalidateQueriesMatching(queryClient, (query) => {
      const { queryKey } = query;

      if (!Array.isArray(queryKey)) return false;

      if (hasQueryPrefix(queryKey, ['charts', 'assignments', 'list'])) {
        return queryKey[3] === patientId;
      }

      if (hasQueryPrefix(queryKey, ['charts', 'assignments', 'patient'])) {
        return queryKey[3] === patientId;
      }

      return false;
    }));
  } else {
    tasks.push(queryClient.invalidateQueries({ queryKey: chartKeys.assignments() }));
  }

  return Promise.all(tasks);
}

export function invalidateChartEntryMutationQueries(
  queryClient,
  { assignmentId, patientId, entryId } = {},
) {
  const tasks = [invalidateChartAssignmentMutationQueries(queryClient, { assignmentId, patientId })];

  if (entryId) {
    tasks.push(invalidateQueryKeys(queryClient, [chartKeys.entryDetail(entryId)]));
  }

  if (assignmentId) {
    tasks.push(invalidateQueryKeys(queryClient, [chartKeys.entrySummary(assignmentId)]));
    tasks.push(invalidateQueriesMatching(queryClient, (query) => {
      const { queryKey } = query;

      if (!Array.isArray(queryKey)) return false;

      if (hasQueryPrefix(queryKey, ['charts', 'entries', 'list'])) {
        return queryKey[3]?.assignment === assignmentId;
      }

      if (hasQueryPrefix(queryKey, ['charts', 'entries', 'trends'])) {
        return queryKey[3] === assignmentId;
      }

      return false;
    }));
  } else {
    tasks.push(queryClient.invalidateQueries({ queryKey: chartKeys.entries() }));
  }

  if (patientId) {
    tasks.push(invalidateQueryKeys(queryClient, [chartKeys.entriesByPatient(patientId)]));
    tasks.push(invalidatePatientTimelineQueries(queryClient, patientId));
  }

  return Promise.all(tasks);
}

// =============================================================================
// Template Queries
// =============================================================================

/**
 * Fetch list of chart templates with optional filters
 * @param {object} filters - Query filters
 * @param {boolean} filters.enabled - Enable/disable the query (for lazy loading)
 */
export function useChartTemplates(filters = {}) {
  const { enabled = true, category, visibility, search, is_active } = filters;
  const params = new URLSearchParams();

  if (category) params.append('category', category);
  if (visibility) params.append('visibility', visibility);
  if (search) params.append('search', search);
  if (is_active !== undefined) params.append('is_active', is_active);

  return useQuery({
    // Use primitive values in query key to prevent duplicate calls from object reference changes
    queryKey: keyWith('charts', 'templates', 'list', category, visibility, search, is_active),
    queryFn: async ({ signal }) => {
      return await apiClient.get(`/charts/templates/?${params.toString()}`, { signal });
    },
    enabled,
    staleTime: 60000, // 1 minute - templates don't change often
    refetchOnWindowFocus: false,
  });
}

/**
 * Fetch a single chart template with all fields
 */
export function useChartTemplate(templateId) {
  return useQuery({
    queryKey: chartKeys.templateDetail(templateId),
    queryFn: async ({ signal }) => {
      return await apiClient.get(`/charts/templates/${templateId}/`, { signal });
    },
    enabled: !!templateId,
  });
}

/**
 * Fetch available template categories
 * @param {object} options - Query options
 * @param {boolean} options.enabled - Enable/disable the query (for lazy loading)
 */
export function useChartCategories(options = {}) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: chartKeys.categories(),
    queryFn: async ({ signal }) => {
      const response = await apiClient.get('/charts/templates/categories/', { signal });
      return response.categories;
    },
    enabled,
    ...immutableMetadataQueryOptions(),
  });
}

/**
 * Fetch available monitoring intervals
 * @param {object} options - Query options
 * @param {boolean} options.enabled - Enable/disable the query (for lazy loading)
 */
export function useChartIntervals(options = {}) {
  const { enabled = true } = options;
  return useQuery({
    queryKey: chartKeys.intervals(),
    queryFn: async ({ signal }) => {
      const response = await apiClient.get('/charts/templates/intervals/', { signal });
      return response.intervals;
    },
    enabled,
    ...immutableMetadataQueryOptions(),
  });
}

// =============================================================================
// Template Mutations
// =============================================================================

/**
 * Create a new chart template
 */
export function useCreateChartTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (templateData) => {
      return await apiClient.post('/charts/templates/', templateData);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: chartKeys.templates() });
      toast.success('Chart template created');
      emitOnboardingEvent('templates.chart.created', {
        success: true,
        template_id: data?.id || null,
      });
    },
    onError: (error) => {
      const message = error.response?.data?.detail || 'Failed to create template';
      toast.error(message);
    },
  });
}

/**
 * Update an existing chart template
 */
export function useUpdateChartTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ templateId, data }) => {
      return await apiClient.patch(`/charts/templates/${templateId}/`, data);
    },
    onSuccess: (data, { templateId }) => {
      queryClient.invalidateQueries({ queryKey: chartKeys.templates() });
      queryClient.setQueryData(chartKeys.templateDetail(templateId), data);
      toast.success('Template updated');
    },
    onError: (error) => {
      const message = error.response?.data?.detail || 'Failed to update template';
      toast.error(message);
    },
  });
}

/**
 * Delete (deactivate) a chart template
 */
export function useDeleteChartTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (templateId) => {
      await apiClient.delete(`/charts/templates/${templateId}/`);
      return templateId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chartKeys.templates() });
      toast.success('Template deleted');
    },
    onError: (error) => {
      const message = error.response?.data?.error || 'Failed to delete template';
      toast.error(message);
    },
  });
}

/**
 * Clone a chart template
 */
export function useCloneChartTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (templateId) => {
      return await apiClient.post(`/charts/templates/${templateId}/clone/`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chartKeys.templates() });
      toast.success('Template cloned');
    },
    onError: (error) => {
      const message = error.response?.data?.detail || 'Failed to clone template';
      toast.error(message);
    },
  });
}

// =============================================================================
// Field Mutations
// =============================================================================

/**
 * Add a field to a template
 */
export function useAddChartField() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ templateId, fieldData }) => {
      return await apiClient.post(`/charts/templates/${templateId}/fields/`, fieldData);
    },
    onSuccess: (data, { templateId }) => {
      queryClient.invalidateQueries({ queryKey: chartKeys.templateDetail(templateId) });
      toast.success('Field added');
    },
    onError: (error) => {
      const message = error.response?.data?.error || error.response?.data?.detail || 'Failed to add field';
      toast.error(message);
    },
  });
}

/**
 * Update a field in a template
 */
export function useUpdateChartField() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ templateId, fieldId, fieldData }) => {
      return await apiClient.patch(
        `/charts/templates/${templateId}/fields/${fieldId}/`,
        fieldData
      );
    },
    onSuccess: (data, { templateId }) => {
      queryClient.invalidateQueries({ queryKey: chartKeys.templateDetail(templateId) });
      toast.success('Field updated');
    },
    onError: (error) => {
      const message = error.response?.data?.error || 'Failed to update field';
      toast.error(message);
    },
  });
}

/**
 * Delete a field from a template
 */
export function useDeleteChartField() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ templateId, fieldId }) => {
      await apiClient.delete(`/charts/templates/${templateId}/fields/${fieldId}/delete/`);
      return { templateId, fieldId };
    },
    onSuccess: (data, { templateId }) => {
      queryClient.invalidateQueries({ queryKey: chartKeys.templateDetail(templateId) });
      toast.success('Field removed');
    },
    onError: (error) => {
      const message = error.response?.data?.error || 'Failed to remove field';
      toast.error(message);
    },
  });
}

/**
 * Reorder fields in a template
 */
export function useReorderChartFields() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ templateId, fields }) => {
      return await apiClient.patch(
        `/charts/templates/${templateId}/fields/reorder/`,
        { fields }
      );
    },
    onSuccess: (data, { templateId }) => {
      queryClient.invalidateQueries({ queryKey: chartKeys.templateDetail(templateId) });
    },
    onError: () => {
      toast.error('Failed to reorder fields');
    },
  });
}

// =============================================================================
// Assignment Queries
// =============================================================================

/**
 * Fetch list of chart assignments with optional filters
 */
export function useChartAssignments(filters = {}, options = {}) {
  // Extract filter values to use as stable primitives in query key
  const { patient, admission, encounter_id, template, status, page_size, ordering, scope_type, all_history } = filters;
  const { enabled = true } = options;
  const params = new URLSearchParams();

  if (patient) params.append('patient', patient);
  if (admission) params.append('admission', admission);
  if (encounter_id) params.append('encounter_id', encounter_id);
  if (template) params.append('template', template);
  if (status) params.append('status', status);
  if (scope_type) params.append('scope_type', scope_type);
  if (all_history) params.append('all_history', 'true');
  if (page_size) params.append('page_size', page_size);
  if (ordering) params.append('ordering', ordering);

  return useQuery({
    // Use primitive values in query key to prevent duplicate calls from object reference changes
    queryKey: keyWith('charts', 'assignments', 'list', patient, admission, encounter_id, template, status, scope_type, all_history, page_size, ordering),
    queryFn: async ({ signal }) => {
      return await apiClient.get(`/charts/assignments/?${params.toString()}`, { signal });
    },
    enabled,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: false,
  });
}

export function usePaginatedChartAssignments(filters = {}, options = {}) {
  const {
    patient,
    admission,
    encounter_id,
    template,
    status,
    scope_type,
    all_history = false,
    ordering = '-created_at',
    page = 1,
    page_size = 12,
  } = filters;
  const { enabled = true } = options;
  const params = new URLSearchParams();

  if (patient) params.append('patient', patient);
  if (admission) params.append('admission', admission);
  if (encounter_id) params.append('encounter_id', encounter_id);
  if (template) params.append('template', template);
  if (status && status !== 'all') params.append('status', status);
  if (scope_type) params.append('scope_type', scope_type);
  if (all_history) params.append('all_history', 'true');
  if (ordering) params.append('ordering', ordering);
  params.append('page', String(page));
  params.append('page_size', String(page_size));

  return useQuery({
    queryKey: chartKeys.assignmentPaginatedList(
      patient,
      admission,
      encounter_id,
      template,
      status,
      scope_type,
      all_history,
      ordering,
      page,
      page_size,
    ),
    queryFn: async ({ signal }) => {
      const response = await apiClient.getWithPagination(`/charts/assignments/?${params.toString()}`, { signal });

      if (Array.isArray(response)) {
        return {
          count: response.length,
          results: response,
          page,
          total_pages: 1,
          has_next: false,
          has_previous: false,
        };
      }

      return response ?? {
        count: 0,
        results: [],
        page,
        total_pages: 1,
        has_next: false,
        has_previous: false,
      };
    },
    enabled: !!patient && enabled,
    placeholderData: {
      count: 0,
      results: [],
      page,
      total_pages: 1,
      has_next: false,
      has_previous: false,
    },
    staleTime: 30000,
    refetchOnWindowFocus: false,
  });
}

/**
 * Fetch a single chart assignment with full details
 */
export function useChartAssignment(assignmentId) {
  return useQuery({
    queryKey: chartKeys.assignmentDetail(assignmentId),
    queryFn: async ({ signal }) => {
      return await apiClient.get(`/charts/assignments/${assignmentId}/`, { signal });
    },
    enabled: !!assignmentId,
  });
}

/**
 * Fetch all chart assignments for a patient
 */
export function usePatientChartAssignments(patientId, status = 'active', filters = {}) {
  return useQuery({
    queryKey: chartKeys.assignmentsByPatient(
      patientId,
      status,
      filters.admission_id,
      filters.encounter_id,
      filters.scope_type,
      filters.all_history,
    ),
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ patient_id: patientId });
      if (status) params.append('status', status);
      if (filters.admission_id) params.append('admission_id', filters.admission_id);
      if (filters.encounter_id) params.append('encounter_id', filters.encounter_id);
      if (filters.scope_type) params.append('scope_type', filters.scope_type);
      if (filters.all_history) params.append('all_history', 'true');

      return await apiClient.get(`/charts/assignments/by-patient/?${params.toString()}`, { signal });
    },
    enabled: !!patientId,
  });
}

// =============================================================================
// Assignment Mutations
// =============================================================================

/**
 * Create a new chart assignment (assign chart to patient)
 */
export function useCreateChartAssignment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (assignmentData) => {
      return await apiClient.post('/charts/assignments/', assignmentData);
    },
    onSuccess: (data, variables) => {
      const assignmentId = normalizeIdentifier(data?.id);
      const patientId = resolveChartPatientId(queryClient, {
        assignmentId,
        sources: [data, variables],
      });

      if (assignmentId) {
        queryClient.setQueryData(chartKeys.assignmentDetail(assignmentId), data);
      }

      void invalidateChartAssignmentMutationQueries(queryClient, { assignmentId, patientId });
      toast.success('Chart assigned to patient');
      emitOnboardingEvent('charts.assignment.created', {
        success: true,
        assignment_id: data?.id || null,
        template_id: data?.template?.id || data?.template || variables?.template_id || null,
        patient_id: data?.patient || variables?.patient || null,
      });
    },
    onError: (error) => {
      const message = error.response?.data?.detail || 'Failed to assign chart';
      toast.error(message);
    },
  });
}

/**
 * Update a chart assignment
 */
export function useUpdateChartAssignment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ assignmentId, data }) => {
      return await apiClient.patch(`/charts/assignments/${assignmentId}/`, data);
    },
    onSuccess: (data, { assignmentId }) => {
      queryClient.setQueryData(chartKeys.assignmentDetail(assignmentId), data);
      const patientId = resolveChartPatientId(queryClient, {
        assignmentId,
        sources: [data],
      });

      void invalidateChartAssignmentMutationQueries(queryClient, { assignmentId, patientId });
    },
    onError: (error) => {
      const message = error.response?.data?.detail || 'Failed to update assignment';
      toast.error(message);
    },
  });
}

/**
 * Complete a chart assignment
 */
export function useCompleteChartAssignment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (assignmentId) => {
      return await apiClient.post(`/charts/assignments/${assignmentId}/complete/`);
    },
    onSuccess: (data, assignmentId) => {
      const patientId = resolveChartPatientId(queryClient, {
        assignmentId,
        sources: [data],
      });

      void invalidateChartAssignmentMutationQueries(queryClient, { assignmentId, patientId });
      toast.success('Chart monitoring completed');
    },
    onError: (error) => {
      const message = error.response?.data?.error || 'Failed to complete assignment';
      toast.error(message);
    },
  });
}

/**
 * Pause a chart assignment
 */
export function usePauseChartAssignment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (assignmentId) => {
      return await apiClient.post(`/charts/assignments/${assignmentId}/pause/`);
    },
    onSuccess: (data, assignmentId) => {
      const patientId = resolveChartPatientId(queryClient, {
        assignmentId,
        sources: [data],
      });

      void invalidateChartAssignmentMutationQueries(queryClient, { assignmentId, patientId });
      toast.success('Chart monitoring paused');
    },
    onError: (error) => {
      const message = error.response?.data?.error || 'Failed to pause assignment';
      toast.error(message);
    },
  });
}

/**
 * Resume a paused chart assignment
 */
export function useResumeChartAssignment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (assignmentId) => {
      return await apiClient.post(`/charts/assignments/${assignmentId}/resume/`);
    },
    onSuccess: (data, assignmentId) => {
      const patientId = resolveChartPatientId(queryClient, {
        assignmentId,
        sources: [data],
      });

      void invalidateChartAssignmentMutationQueries(queryClient, { assignmentId, patientId });
      toast.success('Chart monitoring resumed');
    },
    onError: (error) => {
      const message = error.response?.data?.error || 'Failed to resume assignment';
      toast.error(message);
    },
  });
}

/**
 * Discontinue a chart assignment
 */
export function useDiscontinueChartAssignment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ assignmentId, reason }) => {
      return await apiClient.post(
        `/charts/assignments/${assignmentId}/discontinue/`,
        { reason }
      );
    },
    onSuccess: (data, { assignmentId }) => {
      const patientId = resolveChartPatientId(queryClient, {
        assignmentId,
        sources: [data],
      });

      void invalidateChartAssignmentMutationQueries(queryClient, { assignmentId, patientId });
      toast.success('Chart monitoring discontinued');
    },
    onError: (error) => {
      const message = error.response?.data?.error || 'Failed to discontinue assignment';
      toast.error(message);
    },
  });
}

// =============================================================================
// Entry Queries
// =============================================================================

/**
 * Fetch chart entries with optional filters
 */
export function useChartEntries(filters = {}, options = {}) {
  const params = new URLSearchParams();
  const { enabled = true } = options;

  if (filters.assignment) params.append('assignment', filters.assignment);
  if (filters.start_date) params.append('start_date', filters.start_date);
  if (filters.end_date) params.append('end_date', filters.end_date);
  if (filters.encounter_id) params.append('encounter_id', filters.encounter_id);
  if (filters.admission_id) params.append('admission_id', filters.admission_id);
  if (filters.ordering) params.append('ordering', filters.ordering);
  if (filters.has_critical_values !== undefined) {
    params.append('has_critical_values', filters.has_critical_values);
  }
  if (filters.include_data) {
    params.append('include_data', 'true');
    params.append('page_size', '12');
  }

  return useQuery({
    queryKey: chartKeys.entryList(filters),
    queryFn: async ({ signal }) => {
      return await apiClient.get(`/charts/entries/?${params.toString()}`, { signal });
    },
    enabled: !!filters.assignment && enabled,
  });
}

/**
 * Fetch a single chart entry
 */
export function useChartEntry(entryId) {
  return useQuery({
    queryKey: chartKeys.entryDetail(entryId),
    queryFn: async ({ signal }) => {
      return await apiClient.get(`/charts/entries/${entryId}/`, { signal });
    },
    enabled: !!entryId,
  });
}

/**
 * Fetch entry summary for an assignment
 */
export function useChartEntrySummary(assignmentId, dateRange = {}) {
  return useQuery({
    queryKey: chartKeys.entrySummary(assignmentId, dateRange.start_date, dateRange.end_date),
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ assignment_id: assignmentId });
      if (dateRange.start_date) params.append('start_date', dateRange.start_date);
      if (dateRange.end_date) params.append('end_date', dateRange.end_date);

      return await apiClient.get(`/charts/entries/summary/?${params.toString()}`, { signal });
    },
    enabled: !!assignmentId,
  });
}

/**
 * Fetch trend data for a specific field
 */
export function useChartEntryTrends(assignmentId, fieldKey, options = {}) {
  const {
    limit = 50,
    component,
    start_date,
    end_date,
  } = options;
  return useQuery({
    queryKey: chartKeys.entryTrends(assignmentId, fieldKey, component, start_date, end_date, limit),
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        assignment_id: assignmentId,
        field_key: fieldKey,
        limit: limit.toString(),
      });
      if (component) params.append('component', component);
      if (start_date) params.append('start_date', start_date);
      if (end_date) params.append('end_date', end_date);

      return await apiClient.get(`/charts/entries/trends/?${params.toString()}`, { signal });
    },
    enabled: !!assignmentId && !!fieldKey,
  });
}

/**
 * Fetch all entries for a patient
 */
export function usePatientChartEntries(patientId, filters = {}) {
  return useQuery({
    queryKey: chartKeys.entriesByPatient(
      patientId,
      filters.template_id,
      filters.admission_id,
      filters.encounter_id,
      filters.all_history,
    ),
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ patient_id: patientId });
      if (filters.template_id) params.append('template_id', filters.template_id);
      if (filters.admission_id) params.append('admission_id', filters.admission_id);
      if (filters.encounter_id) params.append('encounter_id', filters.encounter_id);
      if (filters.all_history) params.append('all_history', 'true');
      if (filters.limit) params.append('limit', filters.limit.toString());

      return await apiClient.get(`/charts/entries/by-patient/?${params.toString()}`, { signal });
    },
    enabled: !!patientId,
  });
}

// =============================================================================
// Entry Mutations
// =============================================================================

/**
 * Create a new chart entry (record observation)
 */
export function useCreateChartEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (entryData) => {
      return await apiClient.post('/charts/entries/', entryData);
    },
    onSuccess: (data, variables) => {
      const entryId = normalizeIdentifier(data?.id);
      const assignmentId = resolveChartAssignmentId(queryClient, {
        sources: [data, variables],
      });
      const patientId = resolveChartPatientId(queryClient, {
        assignmentId,
        sources: [data, variables],
      });

      if (entryId) {
        queryClient.setQueryData(chartKeys.entryDetail(entryId), data);
      }

      void invalidateChartEntryMutationQueries(queryClient, {
        assignmentId,
        patientId,
        entryId,
      });

      emitOnboardingEvent('charts.entry.created', {
        success: true,
        entry_id: data?.id || null,
        assignment_id: data?.assignment || variables?.assignment || null,
      });

      if (data.has_critical_values) {
        toast.warning('Entry recorded with critical values', {
          description: 'Please review the highlighted values.',
        });
      } else {
        toast.success('Entry recorded');
      }
    },
    onError: (error) => {
      const message = error.response?.data?.detail || 'Failed to record entry';
      const fieldErrors = error.response?.data?.data;

      if (fieldErrors) {
        // Show first field error
        const firstError = Object.values(fieldErrors)[0];
        toast.error(firstError);
      } else {
        toast.error(message);
      }
    },
  });
}

/**
 * Update a chart entry
 */
export function useUpdateChartEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ entryId, data }) => {
      return await apiClient.patch(`/charts/entries/${entryId}/`, data);
    },
    onSuccess: (data, { entryId }) => {
      queryClient.setQueryData(chartKeys.entryDetail(entryId), data);
      const assignmentId = resolveChartAssignmentId(queryClient, {
        entryId,
        sources: [data],
      });
      const patientId = resolveChartPatientId(queryClient, {
        assignmentId,
        sources: [data],
      });

      void invalidateChartEntryMutationQueries(queryClient, {
        assignmentId,
        patientId,
        entryId,
      });
      toast.success('Entry updated');
    },
    onError: (error) => {
      const message = error.response?.data?.detail || 'Failed to update entry';
      toast.error(message);
    },
  });
}

/**
 * Delete (soft) a chart entry
 */
export function useDeleteChartEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ entryId, reason }) => {
      await apiClient.delete(`/charts/entries/${entryId}/`, { data: { reason } });
      return entryId;
    },
    onSuccess: (data, entryId) => {
      const assignmentId = resolveChartAssignmentId(queryClient, { entryId });
      const patientId = resolveChartPatientId(queryClient, { assignmentId });

      void invalidateChartEntryMutationQueries(queryClient, {
        assignmentId,
        patientId,
        entryId,
      });
      toast.success('Entry deleted');
    },
    onError: (error) => {
      const message = error.response?.data?.detail || 'Failed to delete entry';
      toast.error(message);
    },
  });
}

// =============================================================================
// Utility Hooks
// =============================================================================

/**
 * Hook for managing chart entry form state with calculated fields
 */
export function useChartEntryForm(template) {
  const [formData, setFormData] = React.useState({});

  // Initialize form with default values
  React.useEffect(() => {
    if (template?.fields) {
      const defaults = {};
      template.fields.forEach((field) => {
        defaults[field.field_key] = field.config?.default ?? null;
      });
      setFormData(defaults);
    }
  }, [template]);

  // Calculate computed fields when dependencies change
  const computedData = React.useMemo(() => {
    if (!template?.fields) return formData;

    const result = { ...formData };
    const calculatedFields = template.fields.filter((f) => f.field_type === 'calculated');

    calculatedFields.forEach((field) => {
      const formula = field.config?.formula;
      if (formula) {
        // Simple formula evaluation (for complex formulas, use backend)
        try {
          const value = evaluateSimpleFormula(formula, result);
          if (value !== null) {
            result[field.field_key] = value;
          }
        } catch {
          // Skip on error
        }
      }
    });

    return result;
  }, [formData, template]);

  const updateField = (fieldKey, value) => {
    setFormData((prev) => ({
      ...prev,
      [fieldKey]: value,
    }));
  };

  const resetForm = () => {
    if (template?.fields) {
      const defaults = {};
      template.fields.forEach((field) => {
        defaults[field.field_key] = field.config?.default ?? null;
      });
      setFormData(defaults);
    }
  };

  return {
    formData: computedData,
    updateField,
    resetForm,
    rawData: formData,
  };
}

/**
 * Simple formula evaluator for frontend preview
 * (Full evaluation happens on backend)
 */
function evaluateSimpleFormula(formula, data) {
  // Replace field references with values
  let expression = formula.replace(/\{([a-z_][a-z0-9_]*)\}/g, (match, key) => {
    const value = data[key];
    if (value === null || value === undefined) {
      throw new Error(`Missing value for ${key}`);
    }
    return String(value);
  });

  // Only allow safe characters
  if (!/^[\d\s+\-*/().]+$/.test(expression)) {
    throw new Error('Invalid formula');
  }

  // Evaluate (safe since we validated the expression)
  try {
    // Using Function constructor is safe here because we've validated the input
    const result = new Function(`return ${expression}`)();
    return typeof result === 'number' ? Math.round(result * 100) / 100 : null;
  } catch {
    return null;
  }
}
