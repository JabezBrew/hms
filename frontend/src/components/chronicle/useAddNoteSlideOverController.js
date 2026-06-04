import { useCallback, useEffect, useMemo, useReducer } from "react";

import { useWorkflowKeyboard } from "@/components/ui/workflow-steps";
import { useNoteWorkflow } from "@/hooks/useNoteWorkflow";
import { isRustV2ApiMode } from "@/lib/api/v2/runtime";
import {
  applyDraftToWorkflowData,
  buildStepDiff,
  buildWorkflowNoteData,
  evaluateLintGate,
  mapDraftSectionsToWorkflow,
  sortLintIssues,
  useAINoteDraft,
  useAINoteLint,
} from "@/features/clinical-notes/hooks";
import { CLINICAL_NOTE_TYPES, normalizeClinicalNoteType } from "@/features/clinical-notes/noteTypes";
import { toast } from "sonner";

const CATEGORY_COLORS = {
  [CLINICAL_NOTE_TYPES.DOCTOR]: 'amber',
  [CLINICAL_NOTE_TYPES.NURSING]: 'sky',
  [CLINICAL_NOTE_TYPES.ALLIED_HEALTH]: 'emerald',
};

const INITIAL_AI_ASSISTANT_STATE = {
  draftPrompt: '',
  draftTextByStepId: {},
  draftCitationsByStepId: {},
  lintResult: null,
  lintDataHash: null,
  majorAcknowledgement: {
    dataHash: null,
    acknowledged: false,
  },
};

function aiAssistantReducer(state, action) {
  switch (action.type) {
    case 'setDraftPrompt':
      return {
        ...state,
        draftPrompt: action.prompt,
      };
    case 'draftApplied':
      return {
        ...state,
        draftTextByStepId: action.draftTextByStepId,
        draftCitationsByStepId: action.citationsByStepId,
        lintResult: null,
        lintDataHash: null,
        majorAcknowledgement: INITIAL_AI_ASSISTANT_STATE.majorAcknowledgement,
      };
    case 'lintChecked':
      return {
        ...state,
        lintResult: action.result,
        lintDataHash: action.dataHash,
        majorAcknowledgement: INITIAL_AI_ASSISTANT_STATE.majorAcknowledgement,
      };
    case 'acknowledgeMajor':
      return {
        ...state,
        majorAcknowledgement: {
          dataHash: action.dataHash,
          acknowledged: action.acknowledged,
        },
      };
    case 'reset':
      return INITIAL_AI_ASSISTANT_STATE;
    default:
      return state;
  }
}

function useAiAssistantController({
  encounterId,
  formData,
  patientId,
  steps,
  template,
  templateRevisionId,
  updateStepData,
}) {
  const aiAssistantAvailable = !isRustV2ApiMode();
  const [aiAssistantState, dispatchAiAssistant] = useReducer(
    aiAssistantReducer,
    INITIAL_AI_ASSISTANT_STATE
  );
  const {
    draftPrompt,
    draftTextByStepId,
    draftCitationsByStepId,
    lintResult,
    lintDataHash,
    majorAcknowledgement,
  } = aiAssistantState;

  const noteDraftMutation = useAINoteDraft();
  const noteLintMutation = useAINoteLint();
  const isAiBusy = aiAssistantAvailable && (noteDraftMutation.isPending || noteLintMutation.isPending);

  const finalNoteData = useMemo(() => buildWorkflowNoteData(steps, formData), [steps, formData]);
  const finalDataHash = useMemo(() => JSON.stringify(finalNoteData), [finalNoteData]);
  const majorAcknowledged = majorAcknowledgement.dataHash === finalDataHash
    && majorAcknowledgement.acknowledged;
  const lintIssues = useMemo(() => sortLintIssues(lintResult?.issues || []), [lintResult]);
  const hasLintForCurrentData = !!lintResult && lintDataHash === finalDataHash;
  const lintGate = useMemo(
    () =>
      evaluateLintGate({
        lintResult,
        lintDataHash,
        currentDataHash: finalDataHash,
        majorAcknowledged,
      }),
    [lintResult, lintDataHash, finalDataHash, majorAcknowledged]
  );

  const resetAssistant = useCallback(() => {
    dispatchAiAssistant({ type: 'reset' });
  }, []);

  const applyMergedFormData = useCallback((mergedData) => {
    if (!mergedData || typeof mergedData !== 'object') {
      return;
    }

    Object.entries(mergedData).forEach(([stepId, value]) => {
      const currentValue = formData?.[stepId];
      if (JSON.stringify(currentValue) === JSON.stringify(value)) {
        return;
      }
      updateStepData(stepId, value);
    });
  }, [formData, updateStepData]);

  const handleDraftPromptChange = useCallback((event) => {
    dispatchAiAssistant({
      type: 'setDraftPrompt',
      prompt: event.target.value,
    });
  }, []);

  const runQualityCheck = useCallback(async ({ silent = false } = {}) => {
    if (!aiAssistantAvailable) {
      if (!silent) {
        toast.error('AI note quality checks are not available in Rust V2 mode yet.');
      }
      return null;
    }
    if (!patientId || !template?.id || !templateRevisionId) {
      if (!silent) {
        toast.error('Select a template revision before running quality check.');
      }
      return null;
    }

    try {
      const lintEnvelope = await noteLintMutation.mutateAsync({
        patientId,
        templateId: template.id,
        templateRevisionId,
        encounterId,
        noteData: finalNoteData,
      });

      const result = lintEnvelope?.result || null;
      if (!result) {
        throw new Error('Quality check did not return a valid result.');
      }

      dispatchAiAssistant({
        type: 'lintChecked',
        result,
        dataHash: finalDataHash,
      });

      if (!silent) {
        const issueCounts = result.issue_counts || {};
        const criticalCount = Number(issueCounts.critical || 0);
        const majorCount = Number(issueCounts.major || 0);
        if (criticalCount > 0) {
          toast.error('Quality check found critical issues.', {
            description: 'Resolve critical issues before completing the note.',
          });
        } else if (majorCount > 0) {
          toast.warning('Quality check found major issues.', {
            description: 'Acknowledge major issues before completing.',
          });
        } else {
          toast.success('Quality check complete.', {
            description: 'No blocking issues found.',
          });
        }
      }

      return result;
    } catch (err) {
      if (!silent) {
        toast.error(err?.message || 'Unable to run quality check.');
      }
      return null;
    }
  }, [
    aiAssistantAvailable,
    encounterId,
    finalDataHash,
    finalNoteData,
    noteLintMutation,
    patientId,
    template,
    templateRevisionId,
  ]);

  const handleRunQualityCheck = useCallback(() => {
    void runQualityCheck();
  }, [runQualityCheck]);

  const handleGenerateDraft = useCallback(async () => {
    if (!aiAssistantAvailable) {
      toast.error('AI note drafting is not available in Rust V2 mode yet.');
      return;
    }
    if (!patientId || !template?.id || !templateRevisionId) {
      toast.error('Select a template revision before generating draft.');
      return;
    }

    try {
      const draftEnvelope = await noteDraftMutation.mutateAsync({
        patientId,
        templateId: template.id,
        templateRevisionId,
        encounterId,
        prompt: draftPrompt,
      });

      const sections = Array.isArray(draftEnvelope?.result?.sections) ? draftEnvelope.result.sections : [];
      if (sections.length === 0) {
        toast.error('No AI draft sections were generated.');
        return;
      }

      const { draftTextByStepId: mappedDraftText, citationsByStepId } = mapDraftSectionsToWorkflow(
        steps,
        sections,
        Array.isArray(draftEnvelope?.citations) ? draftEnvelope.citations : []
      );

      const mergedData = applyDraftToWorkflowData({
        steps,
        currentFormData: formData,
        draftTextByStepId: mappedDraftText,
        mode: 'empty_only',
      });

      applyMergedFormData(mergedData);
      dispatchAiAssistant({
        type: 'draftApplied',
        draftTextByStepId: mappedDraftText,
        citationsByStepId,
      });

      toast.success('AI draft applied to empty sections.', {
        description: 'Review and edit content before completion.',
      });
    } catch (err) {
      toast.error(err?.message || 'Unable to generate AI draft.');
    }
  }, [
    applyMergedFormData,
    aiAssistantAvailable,
    draftPrompt,
    encounterId,
    formData,
    noteDraftMutation,
    patientId,
    steps,
    template,
    templateRevisionId,
  ]);

  const handleMajorAcknowledgementChange = useCallback((value) => {
    dispatchAiAssistant({
      type: 'acknowledgeMajor',
      dataHash: finalDataHash,
      acknowledged: Boolean(value),
    });
  }, [finalDataHash]);

  return {
    aiAssistantAvailable,
    finalDataHash,
    finalNoteData,
    handleDraftPromptChange,
    handleGenerateDraft,
    handleMajorAcknowledgementChange,
    handleRunQualityCheck,
    hasLintForCurrentData,
    isAiBusy,
    lintDataHash,
    lintGate,
    lintIssues,
    lintResult,
    majorAcknowledged,
    resetAssistant,
    runQualityCheck,
    draftPrompt,
    draftTextByStepId,
    draftCitationsByStepId,
  };
}

export function useAddNoteSlideOverController({
  open,
  onClose,
  patient,
  patientId,
  encounter = null,
  onNoteCreated,
  initialTemplate = null,
  initialData = null,
  noteDraftOverrides = null,
  editNoteId = null,
}) {
  const isEditMode = !!editNoteId;
  const encounterId = encounter?.id || null;
  const {
    template,
    templateRevisionId,
    steps,
    totalSteps,
    currentStep,
    formData,
    isSaving,
    lastSaved,
    error,
    isLoading,
    startWorkflow,
    updateStepData,
    saveDraft,
    nextStep,
    prevStep,
    goToStep,
    completeWorkflow,
    resetWorkflow,
    // The hook instance is keyed by the parent-owned note open context; the
    // copy-forward synchronization effect below documents the remaining prop-driven start.
    // react-doctor-disable-next-line react-doctor/no-event-handler
  } = useNoteWorkflow(patientId, { editNoteId, encounterId, noteDraftOverrides });

  const isLastStep = currentStep === totalSteps;
  const currentStepConfig = steps[currentStep - 1] || null;
  const categoryColor = CATEGORY_COLORS[normalizeClinicalNoteType(template?.note_type || template?.category)] || 'amber';
  const aiController = useAiAssistantController({
    encounterId,
    formData,
    patientId,
    steps,
    template,
    templateRevisionId,
    updateStepData,
  });
  const {
    aiAssistantAvailable,
    finalDataHash,
    finalNoteData,
    handleDraftPromptChange,
    handleGenerateDraft,
    handleMajorAcknowledgementChange,
    handleRunQualityCheck,
    hasLintForCurrentData,
    isAiBusy,
    lintDataHash,
    lintGate,
    lintIssues,
    lintResult,
    majorAcknowledged,
    resetAssistant,
    draftPrompt,
    draftTextByStepId,
    draftCitationsByStepId,
  } = aiController;

  const currentStepDraftText = currentStepConfig ? draftTextByStepId[currentStepConfig.id] : '';
  const currentStepCitations = currentStepConfig ? draftCitationsByStepId[currentStepConfig.id] || [] : [];
  const currentStepDiff = useMemo(
    () => buildStepDiff(currentStepDraftText, currentStepConfig ? formData[currentStepConfig.id] : ''),
    [currentStepDraftText, currentStepConfig, formData]
  );

  const resetWorkflowAndAssistant = useCallback(() => {
    resetWorkflow();
    resetAssistant();
  }, [resetAssistant, resetWorkflow]);

  const handleSelectTemplate = async (selectedTemplate) => {
    resetAssistant();
    await startWorkflow(selectedTemplate, null, {
      applyTemplateText: true,
      applyMode: 'empty_only',
    });
  };

  const handleStepDataChange = useCallback((stepId, data) => {
    updateStepData(stepId, data);
  }, [updateStepData]);

  const handleCurrentStepDataChange = useCallback((data) => {
    if (!currentStepConfig) {
      return;
    }
    handleStepDataChange(currentStepConfig.id, data);
  }, [currentStepConfig, handleStepDataChange]);

  const handleBack = () => {
    if (currentStep > 1) {
      prevStep();
    } else {
      resetWorkflowAndAssistant();
    }
  };

  const handleNext = async () => {
    await nextStep();
  };

  const handleSaveDraft = async () => {
    await saveDraft();
  };

  const handleComplete = async () => {
    try {
      const hasFreshLint = !!lintResult && lintDataHash === finalDataHash;
      if (hasFreshLint) {
        const gate = evaluateLintGate({
          lintResult,
          lintDataHash,
          currentDataHash: finalDataHash,
          majorAcknowledged,
        });
        if (!gate.canComplete && !gate.requiresLintRun) {
          toast.error(gate.reason || 'Resolve quality issues before completion.');
          return;
        }
      }

      const result = await completeWorkflow();
      if (result?.success || result?.note) {
        resetWorkflowAndAssistant();
        onNoteCreated?.();
        onClose();
      }
    } catch (err) {
      console.error('Failed to complete note:', err);
    }
  };

  const handleClose = () => {
    resetWorkflowAndAssistant();
    onClose();
  };

  useEffect(() => {
    // react-doctor-disable-next-line react-doctor/no-event-handler
    if (open && initialTemplate && !template) {
      startWorkflow(initialTemplate, initialData);
    }
  }, [open, initialTemplate, initialData, template, startWorkflow]);

  useWorkflowKeyboard({
    enabled: open && !!template,
    currentStep,
    totalSteps,
    onNextStep: nextStep,
    onPrevStep: prevStep,
    onGoToStep: goToStep,
    onComplete: completeWorkflow,
    onClose: handleClose,
  });

  const patientName = patient?.local_data?.user_details
    ? `${patient.local_data.user_details.first_name || ''} ${patient.local_data.user_details.last_name || ''}`.trim()
    : patient?.name || 'Patient';

  return {
    aiAssistantAvailable,
    aiStatus: {
      hasLintForCurrentData,
      isAiBusy,
      lintIssues,
      lintResult,
      majorAcknowledged,
      onMajorAcknowledgementChange: handleMajorAcknowledgementChange,
    },
    categoryColor,
    currentStep,
    currentStepConfig,
    currentStepCitations,
    currentStepDiff,
    currentStepDraftText,
    draftPrompt,
    error,
    formData,
    isEditMode,
    lintGate,
    onBack: handleBack,
    onClose: handleClose,
    onComplete: handleComplete,
    onDraftPromptChange: handleDraftPromptChange,
    onGenerateDraft: handleGenerateDraft,
    onGoToStep: goToStep,
    onNext: handleNext,
    onReset: resetWorkflowAndAssistant,
    onRunQualityCheck: handleRunQualityCheck,
    onSaveDraft: handleSaveDraft,
    onSelectTemplate: handleSelectTemplate,
    onStepDataChange: handleCurrentStepDataChange,
    open,
    patient,
    patientName,
    steps,
    template,
    totalSteps,
    workflowStatus: {
      isLastStep,
      isLoading,
      isSaving,
      lastSaved,
    },
    finalNoteData,
  };
}
