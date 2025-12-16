/**
 * Chart Builder React Query Hooks
 *
 * Provides data fetching and mutation hooks for chart templates,
 * assignments, and entries.
 */

import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from 'sonner';

// =============================================================================
// Query Keys
// =============================================================================

export const chartKeys = {
  all: ['charts'],
  templates: () => [...chartKeys.all, 'templates'],
  templateList: (filters) => [...chartKeys.templates(), 'list', filters],
  templateDetail: (id) => [...chartKeys.templates(), 'detail', id],
  categories: () => [...chartKeys.templates(), 'categories'],
  intervals: () => [...chartKeys.templates(), 'intervals'],

  assignments: () => [...chartKeys.all, 'assignments'],
  assignmentList: (filters) => [...chartKeys.assignments(), 'list', filters],
  assignmentDetail: (id) => [...chartKeys.assignments(), 'detail', id],
  assignmentsByPatient: (patientId, status) => [...chartKeys.assignments(), 'patient', patientId, status],

  entries: () => [...chartKeys.all, 'entries'],
  entryList: (filters) => [...chartKeys.entries(), 'list', filters],
  entryDetail: (id) => [...chartKeys.entries(), 'detail', id],
  entrySummary: (assignmentId) => [...chartKeys.entries(), 'summary', assignmentId],
  entryTrends: (assignmentId, fieldKey) => [...chartKeys.entries(), 'trends', assignmentId, fieldKey],
  entriesByPatient: (patientId) => [...chartKeys.entries(), 'patient', patientId],
};

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
    queryKey: ['charts', 'templates', 'list', category, visibility, search, is_active],
    queryFn: async () => {
      return await apiClient.get(`/charts/templates/?${params.toString()}`);
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
    queryFn: async () => {
      return await apiClient.get(`/charts/templates/${templateId}/`);
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
    queryFn: async () => {
      const response = await apiClient.get('/charts/templates/categories/');
      return response.categories;
    },
    staleTime: 1000 * 60 * 60, // Categories rarely change
    enabled,
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
    queryFn: async () => {
      const response = await apiClient.get('/charts/templates/intervals/');
      return response.intervals;
    },
    staleTime: 1000 * 60 * 60,
    enabled,
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
    onError: (error) => {
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
export function useChartAssignments(filters = {}) {
  // Extract filter values to use as stable primitives in query key
  const { patient, admission, template, status } = filters;
  const params = new URLSearchParams();

  if (patient) params.append('patient', patient);
  if (admission) params.append('admission', admission);
  if (template) params.append('template', template);
  if (status) params.append('status', status);

  return useQuery({
    // Use primitive values in query key to prevent duplicate calls from object reference changes
    queryKey: ['charts', 'assignments', 'list', patient, admission, template, status],
    queryFn: async () => {
      return await apiClient.get(`/charts/assignments/?${params.toString()}`);
    },
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: false,
  });
}

/**
 * Fetch a single chart assignment with full details
 */
export function useChartAssignment(assignmentId) {
  return useQuery({
    queryKey: chartKeys.assignmentDetail(assignmentId),
    queryFn: async () => {
      return await apiClient.get(`/charts/assignments/${assignmentId}/`);
    },
    enabled: !!assignmentId,
  });
}

/**
 * Fetch all chart assignments for a patient
 */
export function usePatientChartAssignments(patientId, status = 'active') {
  return useQuery({
    queryKey: chartKeys.assignmentsByPatient(patientId, status),
    queryFn: async () => {
      const params = new URLSearchParams({ patient_id: patientId });
      if (status) params.append('status', status);

      return await apiClient.get(`/charts/assignments/by-patient/?${params.toString()}`);
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
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: chartKeys.assignments() });
      toast.success('Chart assigned to patient');
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
      queryClient.invalidateQueries({ queryKey: chartKeys.assignments() });
      queryClient.setQueryData(chartKeys.assignmentDetail(assignmentId), data);
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chartKeys.assignments() });
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chartKeys.assignments() });
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chartKeys.assignments() });
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chartKeys.assignments() });
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
export function useChartEntries(filters = {}) {
  const params = new URLSearchParams();

  if (filters.assignment) params.append('assignment', filters.assignment);
  if (filters.start_date) params.append('start_date', filters.start_date);
  if (filters.end_date) params.append('end_date', filters.end_date);
  if (filters.has_critical_values !== undefined) {
    params.append('has_critical_values', filters.has_critical_values);
  }

  return useQuery({
    queryKey: chartKeys.entryList(filters),
    queryFn: async () => {
      return await apiClient.get(`/charts/entries/?${params.toString()}`);
    },
    enabled: !!filters.assignment,
  });
}

/**
 * Fetch a single chart entry
 */
export function useChartEntry(entryId) {
  return useQuery({
    queryKey: chartKeys.entryDetail(entryId),
    queryFn: async () => {
      return await apiClient.get(`/charts/entries/${entryId}/`);
    },
    enabled: !!entryId,
  });
}

/**
 * Fetch entry summary for an assignment
 */
export function useChartEntrySummary(assignmentId, dateRange = {}) {
  return useQuery({
    queryKey: chartKeys.entrySummary(assignmentId),
    queryFn: async () => {
      const params = new URLSearchParams({ assignment_id: assignmentId });
      if (dateRange.start_date) params.append('start_date', dateRange.start_date);
      if (dateRange.end_date) params.append('end_date', dateRange.end_date);

      return await apiClient.get(`/charts/entries/summary/?${params.toString()}`);
    },
    enabled: !!assignmentId,
  });
}

/**
 * Fetch trend data for a specific field
 */
export function useChartEntryTrends(assignmentId, fieldKey, limit = 50) {
  return useQuery({
    queryKey: chartKeys.entryTrends(assignmentId, fieldKey),
    queryFn: async () => {
      const params = new URLSearchParams({
        assignment_id: assignmentId,
        field_key: fieldKey,
        limit: limit.toString(),
      });

      return await apiClient.get(`/charts/entries/trends/?${params.toString()}`);
    },
    enabled: !!assignmentId && !!fieldKey,
  });
}

/**
 * Fetch all entries for a patient
 */
export function usePatientChartEntries(patientId, filters = {}) {
  return useQuery({
    queryKey: chartKeys.entriesByPatient(patientId),
    queryFn: async () => {
      const params = new URLSearchParams({ patient_id: patientId });
      if (filters.template_id) params.append('template_id', filters.template_id);
      if (filters.limit) params.append('limit', filters.limit.toString());

      return await apiClient.get(`/charts/entries/by-patient/?${params.toString()}`);
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
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: chartKeys.entries() });
      queryClient.invalidateQueries({ queryKey: chartKeys.assignments() });

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
      queryClient.invalidateQueries({ queryKey: chartKeys.entries() });
      queryClient.setQueryData(chartKeys.entryDetail(entryId), data);
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chartKeys.entries() });
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
        } catch (e) {
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

