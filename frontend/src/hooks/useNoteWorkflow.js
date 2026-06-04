import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { clinicalNotesApi } from '@/features/clinical-notes/api';
import { patientKeys } from '@/features/patients/hooks/usePatientQueries';
import { encounterKeys } from '@/features/encounters/hooks/useEncounterQueries';
import { clinicalNotesKeys } from '@/hooks/useClinicalNotesQueries';
import { timelineKeys } from '@/hooks/useTimelineQueries';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { ensureRustV2WorkflowSupported } from './workflowV2Guard';

/**
 * Derive workflow steps from a template structure
 * @param {Object} template - The note template object
 * @returns {Array} Array of step configurations
 */
function deriveStepsFromTemplate(template) {
  if (!template?.structure) return [];

  // Handle both array and object structure formats
  const sections = Array.isArray(template.structure)
    ? template.structure
    : template.structure.sections || [];

  return sections.map((section, index) => ({
    id: section.name || section.section || `step_${index}`,
    title: section.name || section.section || `Step ${index + 1}`,
    type: section.type || 'text',
    required: section.required ?? false,
    subsections: section.subsections || null,
    observationType: section.observationType || section.observation_type || null,
    helpText: section.helpText || null,
    placeholder: section.placeholder || null,
    defaultText: section.default_text || section.defaultText || null,
  }));
}

function normalizeDataKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function toSubsectionFieldKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

function buildNormalizedKeyLookup(record) {
  const lookup = new Map();
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return lookup;
  }

  Object.keys(record).forEach((key) => {
    const normalized = normalizeDataKey(key);
    if (normalized && !lookup.has(normalized)) {
      lookup.set(normalized, key);
    }
  });

  return lookup;
}

function resolveByAliases(record, lookup, aliases = []) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return undefined;
  }

  for (const alias of aliases) {
    if (!alias) continue;

    if (Object.prototype.hasOwnProperty.call(record, alias)) {
      return record[alias];
    }

    const normalizedAlias = normalizeDataKey(alias);
    const matchedKey = lookup.get(normalizedAlias);
    if (matchedKey !== undefined) {
      return record[matchedKey];
    }
  }

  return undefined;
}

function mapStructuredStepValue(step, rawValue) {
  if (rawValue === undefined || rawValue === null) return undefined;

  const subsections = Array.isArray(step?.subsections) ? step.subsections : [];

  // Legacy notes may store structured sections as plain strings.
  // Put the text into the first subsection so clinicians can edit without retyping.
  if (typeof rawValue === 'string') {
    if (subsections.length === 0) return rawValue;
    const firstSubsectionName = subsections[0]?.name;
    const firstSubsectionKey = toSubsectionFieldKey(firstSubsectionName);
    if (!firstSubsectionKey) return rawValue;
    return { [firstSubsectionKey]: rawValue };
  }

  if (typeof rawValue !== 'object' || Array.isArray(rawValue)) {
    return rawValue;
  }

  if (subsections.length === 0) {
    return rawValue;
  }

  const rawLookup = buildNormalizedKeyLookup(rawValue);
  const mappedValue = {};

  subsections.forEach((subsection) => {
    if (!subsection?.name) return;
    const subsectionKey = toSubsectionFieldKey(subsection.name);
    if (!subsectionKey) return;

    const subsectionValue = resolveByAliases(rawValue, rawLookup, [
      subsectionKey,
      subsection.name,
    ]);

    if (subsectionValue !== undefined) {
      mappedValue[subsectionKey] = subsectionValue;
    }
  });

  return Object.keys(mappedValue).length > 0 ? mappedValue : rawValue;
}

function mapInitialDataToWorkflowSteps(initialData, derivedSteps) {
  if (!initialData || typeof initialData !== 'object' || Array.isArray(initialData)) {
    return {};
  }

  const initialLookup = buildNormalizedKeyLookup(initialData);
  const mappedFormData = {};

  derivedSteps.forEach((step) => {
    if (!step?.id) return;

    const rawStepValue = resolveByAliases(initialData, initialLookup, [step.id, step.title]);
    if (rawStepValue === undefined) return;

    if (step.type === 'structured') {
      const structuredValue = mapStructuredStepValue(step, rawStepValue);
      if (structuredValue !== undefined) {
        mappedFormData[step.id] = structuredValue;
      }
      return;
    }

    mappedFormData[step.id] = rawStepValue;
  });

  return mappedFormData;
}

/**
 * useNoteWorkflow - Hook for managing clinical note workflow state
 *
 * Features:
 * - Template-driven workflow (steps derived from template structure)
 * - Workflow lifecycle management (start, update, complete)
 * - Auto-save with debounce
 * - Local state management for form data
 * - API integration
 * - Edit mode support for updating existing notes
 *
 * @param {string} patientId - The patient ID for the note
 * @param {Object} options - Optional configuration
 * @param {string} options.editNoteId - If provided, we're editing an existing note
 * @returns {Object} Workflow state and actions
 */
export function useNoteWorkflow(patientId, options = {}) {
  const { editNoteId = null, encounterId = null, noteDraftOverrides = null } = options;
  const queryClient = useQueryClient();

  // Workflow state
  const [workflowId, setWorkflowId] = useState(null);
  const [template, setTemplate] = useState(null);  // Now stores full template object
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState({});
  const [templateRevisionId, setTemplateRevisionId] = useState(null);
  const [templateRevisionVersion, setTemplateRevisionVersion] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [error, setError] = useState(null);

  // Auto-save timer ref
  const autoSaveTimerRef = useRef(null);
  const pendingChangesRef = useRef(false);

  // Derive steps from current template
  const steps = useMemo(() => {
    return deriveStepsFromTemplate(template);
  }, [template]);

  // Computed values
  const totalSteps = steps.length;
  const noteType = template?.id || null;  // Use template ID as noteType

  // Start workflow mutation
  // No cache invalidation: the returned workflow id is stored as local draft state; completion invalidates patient, notes, encounter, and timeline caches.
  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation
  const startWorkflowMutation = useMutation({
    mutationFn: async ({ patientId, template, templateRevisionId }) => {
      ensureRustV2WorkflowSupported('Clinical-note workflow start');
      const data = await apiClient.post('/workflows/clinical-note/start/', {
        patient_id: patientId,
        note_type: template.category || 'custom',  // Send category as note_type
        template_id: template.id,  // Send template ID
        template_revision_id: templateRevisionId,
      });
      return data;
    },
    onSuccess: (data) => {
      setWorkflowId(data.id);
      setCurrentStep(1);
      setError(null);
    },
    onError: (error) => {
      setError(error.message || 'Failed to start workflow');
    },
  });

  // Update step mutation
  // No cache invalidation: step saves update local draft progress only; completion invalidates patient, notes, encounter, and timeline caches.
  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation
  const updateStepMutation = useMutation({
    mutationFn: async ({ workflowId, stepData, nextStep, noteFields }) => {
      ensureRustV2WorkflowSupported('Clinical-note workflow step update');
      const data = await apiClient.patch(
        `/workflows/${workflowId}/clinical-note/step/`,
        {
          step_data: stepData,
          next_step: nextStep,
          ...noteFields,
        }
      );
      return data;
    },
    onSuccess: (data) => {
      setCurrentStep(data.current_step);
      setLastSaved(new Date());
      pendingChangesRef.current = false;
      setError(null);
    },
    onError: (error) => {
      setError(error.message || 'Failed to update step');
    },
  });

  // Save draft mutation
  // No cache invalidation: autosave confirms server persistence of the local draft and does not update clinical timeline/note caches.
  // react-doctor-disable-next-line react-doctor/query-mutation-missing-invalidation
  const saveDraftMutation = useMutation({
    mutationFn: async ({ workflowId, contextData }) => {
      ensureRustV2WorkflowSupported('Clinical-note workflow draft save');
      const data = await apiClient.post(
        `/workflows/${workflowId}/save-draft/`,
        {
          context_data: contextData,
        }
      );
      return data;
    },
    onSuccess: (data) => {
      setLastSaved(new Date(data.last_autosave));
      pendingChangesRef.current = false;
    },
    onError: (error) => {
      console.error('Auto-save failed:', error);
    },
  });

  // Complete workflow mutation - creates or updates note entry
  const completeWorkflowMutation = useMutation({
    mutationFn: async ({
      workflowId,
      template,
      finalData,
      patientId,
      editNoteId,
      templateRevisionId,
      noteDraftOverrides,
    }) => {
      // If we're editing an existing note, update it
      if (editNoteId) {
        const noteEntry = await clinicalNotesApi.updateNoteEntry(
          editNoteId,
          finalData,
          'Updated via note editor'
        );
        return { success: true, note: noteEntry, isEdit: true };
      }

      // Always create the note via the clinical-notes API. The workflow's
      // /complete/ endpoint depended on per-step PATCH calls populating its
      // ClinicalNoteWorkflow row; since we no longer hit the server per step,
      // that path 500s. Creating the NoteEntry directly is the canonical path
      // (also used by DynamicNoteForm) and doesn't need any prior workflow
      // state. The backend draft workflow (if one exists) is left as-is — it
      // can be cleaned up server-side or via save-draft, but is not on the
      // critical path for note creation.
      const noteEntry = await clinicalNotesApi.createNoteEntry({
        template_id: template.id,
        template_revision_id: templateRevisionId,
        template,
        note_type: noteDraftOverrides?.noteType || template.note_type || template.category,
        title: noteDraftOverrides?.title || template.title,
        patient_id: patientId,
        encounter_id: encounterId || undefined,
        data: finalData,
      });
      return { success: true, note: noteEntry, workflowId };
    },
    onSuccess: () => {
      // Invalidate relevant queries
      queryClient.invalidateQueries({ queryKey: patientKeys.detail(patientId) });
      queryClient.invalidateQueries({ queryKey: encounterKeys.all });
      queryClient.invalidateQueries({ queryKey: clinicalNotesKeys.entries() });
      queryClient.invalidateQueries({ queryKey: timelineKeys.all });
      setError(null);
    },
    onError: (error) => {
      setError(error.message || 'Failed to complete note');
    },
  });

  // Start a new workflow with a template
  const startWorkflow = useCallback(async (selectedTemplate, initialData = null, workflowOptions = {}) => {
    if (!patientId) {
      setError('Patient ID is required');
      return;
    }

    const {
      applyTemplateText = false,
      applyMode = 'empty_only',
      selectedSections = [],
    } = workflowOptions;

    // Store the full template object
    setTemplate(selectedTemplate);
    setLastSaved(null);
    setError(null);  // Clear any previous errors

    const selectedRevisionId = selectedTemplate?.latest_published_revision_id || null;
    const selectedRevisionVersion = selectedTemplate?.latest_published_revision_version || null;
    setTemplateRevisionId(selectedRevisionId);
    setTemplateRevisionVersion(selectedRevisionVersion);

    // If initial data provided (e.g., from copy), pre-populate formData
    let nextFormData = {};
    if (initialData && typeof initialData === 'object') {
      const derivedSteps = deriveStepsFromTemplate(selectedTemplate);
      const mappedFormData = mapInitialDataToWorkflowSteps(initialData, derivedSteps);
      nextFormData = mappedFormData;
    }

    if (applyTemplateText) {
      try {
        const renderResult = await clinicalNotesApi.renderTemplate(selectedTemplate.id, {
          patient_id: patientId,
          revision_id: selectedRevisionId,
          apply_mode: applyMode,
          base_data: nextFormData,
          sections: selectedSections,
        });
        if (renderResult?.rendered_data && typeof renderResult.rendered_data === 'object') {
          nextFormData = {
            ...nextFormData,
            ...renderResult.rendered_data,
          };
        }
        if (renderResult?.revision_id) {
          setTemplateRevisionId(renderResult.revision_id);
        }
        if (renderResult?.revision_version) {
          setTemplateRevisionVersion(renderResult.revision_version);
        }
      } catch (renderError) {
        console.warn('Template render failed, continuing without defaults:', renderError);
      }
    }
    setFormData(nextFormData);

    setCurrentStep(0);

    if (isRustV2ApiMode()) {
      setWorkflowId(null);
      setCurrentStep(1);
      return;
    }

    try {
      await startWorkflowMutation.mutateAsync({
        patientId,
        template: selectedTemplate,
        templateRevisionId: selectedRevisionId,
      });
    } catch (err) {
      // If backend workflow fails, still allow local workflow
      console.warn('Backend workflow unavailable, using local mode:', err);
      setError(null);  // Clear error - we're falling back to local mode
      setCurrentStep(1);  // Start at step 1 in local mode
    }
  }, [patientId, startWorkflowMutation]);

  // Update form data for a step
  const updateStepData = useCallback((stepId, data) => {
    setFormData((prev) => ({
      ...prev,
      [stepId]: data,
    }));
    pendingChangesRef.current = true;
  }, []);

  // Save current step and optionally advance
  const saveStep = useCallback(async (nextStepNum = null) => {
    if (!template) return;

    setIsSaving(true);

    try {
      if (workflowId) {
        const currentStepConfig = steps[currentStep - 1];
        const stepData = formData[currentStepConfig?.id] || {};

        await updateStepMutation.mutateAsync({
          workflowId,
          stepData: { [currentStepConfig?.id]: stepData },
          nextStep: nextStepNum,
          noteFields: stepData,
        });
      } else if (nextStepNum) {
        // Local mode - just update step
        setCurrentStep(nextStepNum);
      }
    } finally {
      setIsSaving(false);
    }
  }, [workflowId, template, steps, currentStep, formData, updateStepMutation]);

  // Navigate to next step (local only — form data is already in React state, the
  // workflow's auto-save and final complete cover persistence; we don't need to
  // hit the server on every navigation click).
  const nextStep = useCallback(() => {
    setCurrentStep((current) => (current < totalSteps ? current + 1 : current));
  }, [totalSteps]);

  // Navigate to previous step
  const prevStep = useCallback(() => {
    setCurrentStep((current) => (current > 1 ? current - 1 : current));
  }, []);

  // Navigate to a specific step (for clickable step indicators)
  const goToStep = useCallback((stepNumber) => {
    if (stepNumber >= 1 && stepNumber <= totalSteps && stepNumber !== currentStep) {
      setCurrentStep(stepNumber);
    }
  }, [currentStep, totalSteps]);

  // Save draft (for auto-save)
  const saveDraft = useCallback(async () => {
    if (!workflowId || !pendingChangesRef.current) return;

    setIsSaving(true);

    try {
      await saveDraftMutation.mutateAsync({
        workflowId,
        contextData: formData,
      });
    } finally {
      setIsSaving(false);
    }
  }, [workflowId, formData, saveDraftMutation]);

  // Complete the workflow
  const completeWorkflow = useCallback(async () => {
    if (!template) return;

    setIsSaving(true);

    try {
      // Build final data from all form data
      // Structure it according to template sections
      const finalData = {};
      steps.forEach((step) => {
        if (formData[step.id]) {
          finalData[step.id] = formData[step.id];
        }
      });

      const result = await completeWorkflowMutation.mutateAsync({
        workflowId,
        template,
        finalData,
        patientId,
        templateRevisionId,
        editNoteId,  // Pass editNoteId to trigger update instead of create
        noteDraftOverrides,
      });

      return result;
    } finally {
      setIsSaving(false);
    }
  }, [workflowId, template, steps, formData, patientId, templateRevisionId, editNoteId, noteDraftOverrides, completeWorkflowMutation]);

  // Reset workflow state
  const resetWorkflow = useCallback(() => {
    setWorkflowId(null);
    setTemplate(null);
    setCurrentStep(0);
    setFormData({});
    setTemplateRevisionId(null);
    setTemplateRevisionVersion(null);
    setLastSaved(null);
    setError(null);

    // Clear auto-save timer
    if (autoSaveTimerRef.current) {
      clearInterval(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
  }, []);

  // Auto-save effect
  useEffect(() => {
    if (workflowId) {
      // Set up auto-save every 30 seconds
      autoSaveTimerRef.current = setInterval(() => {
        if (pendingChangesRef.current) {
          saveDraft();
        }
      }, 30000);

      return () => {
        if (autoSaveTimerRef.current) {
          clearInterval(autoSaveTimerRef.current);
        }
      };
    }
  }, [workflowId, saveDraft]);

  // Get current step configuration
  const getCurrentStepConfig = useCallback(() => {
    if (!template || currentStep === 0) return null;

    const stepConfig = steps[currentStep - 1];
    if (!stepConfig) return null;

    return {
      ...stepConfig,
      stepNumber: currentStep,
      totalSteps,
      isFirstStep: currentStep === 1,
      isLastStep: currentStep === totalSteps,
    };
  }, [template, steps, currentStep, totalSteps]);

  return {
    // State
    workflowId,
    noteType,  // Template ID for compatibility
    template,  // Full template object
    templateRevisionId,
    templateRevisionVersion,
    currentStep,
    formData,
    isSaving,
    lastSaved,
    error,
    isLoading: startWorkflowMutation.isPending || updateStepMutation.isPending || completeWorkflowMutation.isPending,
    isEditMode: !!editNoteId,  // Boolean flag for edit mode
    editNoteId,  // The ID of the note being edited (if any)

    // Derived from template
    steps,
    totalSteps,
    getCurrentStepConfig,

    // Actions
    startWorkflow,
    updateStepData,
    saveStep,
    nextStep,
    prevStep,
    goToStep,
    saveDraft,
    completeWorkflow,
    resetWorkflow,
  };
}

export default useNoteWorkflow;
export { deriveStepsFromTemplate, mapInitialDataToWorkflowSteps };
