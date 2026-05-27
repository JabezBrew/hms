import X from 'lucide-react/dist/esm/icons/x.js';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import Save from 'lucide-react/dist/esm/icons/save.js';
import Check from 'lucide-react/dist/esm/icons/check.js';
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles.js';
import ShieldCheck from 'lucide-react/dist/esm/icons/shield-check.js';
import ShieldAlert from 'lucide-react/dist/esm/icons/shield-alert.js';
import { useCallback, useEffect, useMemo, useReducer } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";

import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  WorkflowSteps,
  WorkflowKeyboardHints,
  useWorkflowKeyboard,
} from "@/components/ui/workflow-steps";
import NoteTypeSelector from "./NoteTypeSelector";
import DynamicWorkflowStep from "./DynamicWorkflowStep";
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
import { toast } from "sonner";

// Category color mapping
const CATEGORY_COLORS = {
  general: 'amber',
  soap: 'amber',
  progress: 'amber',
  procedure: 'rose',
  admission: 'emerald',
  discharge: 'emerald',
  nursing: 'sky',
  consultation: 'amber',
  custom: 'violet',
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

function buildContentKey({ open, patientId, editNoteId, initialTemplate }) {
  if (!open) {
    return 'closed';
  }

  return [
    'open',
    patientId || 'unknown-patient',
    editNoteId || 'new-note',
    initialTemplate?.id || 'manual-template',
  ].join(':');
}

/**
 * AddNoteSlideOver - Split-screen panel for creating/editing clinical notes
 *
 * Features:
 * - Slides in from right without backdrop (timeline remains visible)
 * - Template-based note type selection
 * - Multi-step workflow derived from template structure
 * - Auto-save indicator
 * - Step progress visualization
 * - Backend API integration via useNoteWorkflow hook
 * - Copy forward support via initialTemplate and initialData props
 * - Edit mode support via editNoteId prop
 */
const AddNoteSlideOver = ({
  open,
  onClose,
  patient,
  encounter = null,
  onNoteCreated,
  initialTemplate = null,  // Pre-selected template (for copy forward or edit)
  initialData = null,      // Pre-filled data (for copy forward or edit)
  editNoteId = null,       // If provided, we're editing an existing note
}) => {
  const patientId = patient?.local_data?.id || patient?.id;
  const contentKey = buildContentKey({ open, patientId, editNoteId, initialTemplate });

  return (
    <div
      className={cn(
        "fixed inset-y-0 right-0 z-[100] w-full lg:w-1/2 bg-background border-l border-border",
        "transform transition-transform duration-300 ease-in-out",
        "flex flex-col shadow-2xl",
        open ? "translate-x-0" : "translate-x-full"
      )}
    >
      <AddNoteSlideOverContent
        key={contentKey}
        open={open}
        onClose={onClose}
        patient={patient}
        patientId={patientId}
        encounter={encounter}
        onNoteCreated={onNoteCreated}
        initialTemplate={initialTemplate}
        initialData={initialData}
        editNoteId={editNoteId}
      />
    </div>
  );
};

const AddNoteSlideOverContent = ({
  open,
  onClose,
  patient,
  patientId,
  encounter = null,
  onNoteCreated,
  initialTemplate = null,
  initialData = null,
  editNoteId = null,
}) => {
  // Determine if we're in edit mode
  const isEditMode = !!editNoteId;
  const aiAssistantAvailable = !isRustV2ApiMode();

  // Use the template-driven workflow hook
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
  } = useNoteWorkflow(patientId, { editNoteId });

  // Computed values
  const isLastStep = currentStep === totalSteps;
  const currentStepConfig = steps[currentStep - 1] || null;
  const categoryColor = CATEGORY_COLORS[template?.category] || 'amber';
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

  const encounterId = encounter?.id || null;

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
  const currentStepDraftText = currentStepConfig ? draftTextByStepId[currentStepConfig.id] : '';
  const currentStepCitations = currentStepConfig ? draftCitationsByStepId[currentStepConfig.id] || [] : [];
  const currentStepDiff = useMemo(
    () => buildStepDiff(currentStepDraftText, currentStepConfig ? formData[currentStepConfig.id] : ''),
    [currentStepDraftText, currentStepConfig, formData]
  );

  const resetWorkflowAndAssistant = useCallback(() => {
    resetWorkflow();
    dispatchAiAssistant({ type: 'reset' });
  }, [resetWorkflow]);

  // Handle template selection
  const handleSelectTemplate = async (selectedTemplate) => {
    dispatchAiAssistant({ type: 'reset' });
    await startWorkflow(selectedTemplate, null, {
      applyTemplateText: true,
      applyMode: 'empty_only',
    });
  };

  // Handle step data update
  const handleStepDataChange = useCallback((stepId, data) => {
    updateStepData(stepId, data);
  }, [updateStepData]);

  const handleCurrentStepDataChange = useCallback((data) => {
    if (!currentStepConfig) {
      return;
    }
    handleStepDataChange(currentStepConfig.id, data);
  }, [currentStepConfig, handleStepDataChange]);

  const handleDraftPromptChange = useCallback((event) => {
    dispatchAiAssistant({
      type: 'setDraftPrompt',
      prompt: event.target.value,
    });
  }, []);

  // Navigation handlers
  const handleBack = () => {
    if (currentStep > 1) {
      prevStep();
    } else {
      // Go back to template selection
      resetWorkflowAndAssistant();
    }
  };

  const handleNext = async () => {
    await nextStep();
  };

  const handleSaveDraft = async () => {
    await saveDraft();
  };

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

  const handleComplete = async () => {
    try {
      // Quality check is advisory: only block when the user has actually run a
      // check and it returned blocking issues. We never auto-fire the lint API
      // on completion.
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

  const handleMajorAcknowledgementChange = useCallback((value) => {
    dispatchAiAssistant({
      type: 'acknowledgeMajor',
      dataHash: finalDataHash,
      acknowledged: Boolean(value),
    });
  }, [finalDataHash]);

  // Auto-start workflow when opened with initial template (copy forward)
  useEffect(() => {
    if (open && initialTemplate && !template) {
      startWorkflow(initialTemplate, initialData);
    }
  }, [open, initialTemplate, initialData, template, startWorkflow]);

  // Keyboard navigation for steps
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

  // Get patient display name
  const patientName = patient?.local_data?.user_details
    ? `${patient.local_data.user_details.first_name || ''} ${patient.local_data.user_details.last_name || ''}`.trim()
    : patient?.name || 'Patient';

  return (
    <>
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <div>
            <div className="flex items-center gap-2">
              {template && (
                <span className={cn(
                  "px-2 py-0.5 rounded font-mono text-[10px] uppercase tracking-wider",
                  categoryColor === 'amber' && "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
                  categoryColor === 'rose' && "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-400",
                  categoryColor === 'sky' && "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-400",
                  categoryColor === 'emerald' && "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
                  categoryColor === 'violet' && "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400"
                )}>
                  {template.title}
                </span>
              )}
              <h2 className="font-display text-xl text-foreground">
                {template ? (isEditMode ? 'Edit Note' : 'New Note') : 'Add Note'}
              </h2>
            </div>
            <p className="font-mono text-xs text-muted-foreground mt-0.5">
              {patientName}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Auto-save indicator */}
          {template && (
            <span className="font-mono text-xs text-muted-foreground">
              {isSaving || isLoading ? (
                'Saving...'
              ) : lastSaved ? (
                `Saved ${lastSaved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
              ) : (
                'Draft'
              )}
            </span>
          )}

          {/* Close Button */}
          <Button
            variant="destructive"
            size="sm"
            onClick={handleClose}
            className="font-mono text-xs bg-red-500 hover:bg-red-600 text-white"
          >
            <X className="size-4 mr-1.5" />
            Close
          </Button>
        </div>
      </header>

      {/* Error Alert with back option */}
      {error && (
        <Alert variant="destructive" className="mx-6 mt-4">
          <AlertCircle className="size-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>{error}</span>
            {template && (
              <Button
                variant="outline"
                size="sm"
                onClick={resetWorkflowAndAssistant}
                className="ml-4 font-mono text-xs"
              >
                <ChevronLeft className="size-3.5 mr-1" />
                Back
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Step Progress - show when template selected and has steps */}
      {template && steps.length > 0 && currentStep > 0 && (
        <div className="px-6 py-3 bg-muted/30 border-b border-border">
          {/* Change Note Type Link */}
          <div className="flex items-center justify-between mb-3">
            <button
              type="button"
              onClick={resetWorkflowAndAssistant}
              className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors font-mono text-xs"
            >
              <ChevronLeft className="size-3.5" />
              Change Note Type
            </button>
            <span className="font-mono text-xs text-muted-foreground">
              Step {currentStep} of {totalSteps}
            </span>
          </div>
          {/* Step Progress Indicators - Clickable */}
          <WorkflowSteps
            steps={steps}
            currentStep={currentStep}
            onStepClick={goToStep}
          />
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 chronicle-scrollbar">
        {!template ? (
          <NoteTypeSelector onSelect={handleSelectTemplate} enabled={open} />
        ) : currentStepConfig ? (
          <div className="space-y-4">
            {aiAssistantAvailable && (
            <div className="rounded-xl border border-border bg-card p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="size-4 text-amber-600" />
                  <p className="font-heading text-sm text-foreground">AI Note Assistant</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={cn(
                      "font-mono text-[10px]",
                      hasLintForCurrentData
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : lintResult
                          ? "border-amber-200 bg-amber-50 text-amber-700"
                          : "border-border text-muted-foreground"
                    )}
                  >
                    {hasLintForCurrentData ? 'Quality Checked' : lintResult ? 'Quality Check Stale' : 'Not Checked'}
                  </Badge>
                  {hasLintForCurrentData && lintResult?.can_finalize === false && (
                    <Badge variant="outline" className="font-mono text-[10px] border-rose-200 bg-rose-50 text-rose-700">
                      Critical Block
                    </Badge>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-2 lg:flex-row">
                <Input
                  value={draftPrompt}
                  onChange={handleDraftPromptChange}
                  placeholder="Optional draft focus (e.g., 'post-op handoff')"
                  className="h-8 font-mono text-xs"
                  disabled={isAiBusy}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleGenerateDraft}
                  disabled={isAiBusy}
                  className="font-mono text-xs"
                >
                  <Sparkles className="size-3.5 mr-1.5" />
                  Generate Draft
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleRunQualityCheck}
                  disabled={isAiBusy}
                  className="font-mono text-xs"
                >
                  <ShieldCheck className="size-3.5 mr-1.5" />
                  Run Quality Check
                </Button>
              </div>
            </div>
            )}

            <DynamicWorkflowStep
              stepConfig={currentStepConfig}
              formData={formData[currentStepConfig.id] || {}}
              onDataChange={handleCurrentStepDataChange}
              patient={patient}
              template={template}
            />

            {aiAssistantAvailable && currentStepDraftText && (
              <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Sparkles className="size-4 text-amber-600" />
                    <p className="font-heading text-sm text-foreground">Section Diff</p>
                  </div>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    AI Draft vs Current Edit
                  </Badge>
                </div>

                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="rounded-md border border-border/70 bg-muted/20 p-3">
                    <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground mb-2">AI Draft</p>
                    <p className="text-xs whitespace-pre-wrap text-foreground">
                      {currentStepDiff.baseline || 'No AI draft baseline for this step.'}
                    </p>
                  </div>
                  <div className="rounded-md border border-border/70 bg-muted/20 p-3">
                    <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Your Edit</p>
                    <p className="text-xs whitespace-pre-wrap text-foreground">
                      {currentStepDiff.current || 'No content entered yet.'}
                    </p>
                  </div>
                </div>

                <div className="rounded-md border border-border/70 bg-background p-3">
                  <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Diff Preview</p>
                  <p className="text-xs leading-relaxed whitespace-pre-wrap">
                    {currentStepDiff.segments.map((segment, idx) => (
                      <span
                        key={`${segment.value}-${idx}`}
                        className={cn(
                          segment.added && "bg-emerald-100 text-emerald-900",
                          segment.removed && "bg-rose-100 text-rose-900 line-through"
                        )}
                      >
                        {segment.value}
                      </span>
                    ))}
                  </p>
                </div>

                {currentStepCitations.length > 0 && (
                  <div className="space-y-1">
                    <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">Evidence</p>
                    <div className="flex flex-wrap gap-1">
                      {currentStepCitations.map((citation, idx) => (
                        <Badge key={`${citation.type || citation.source}:${citation.id || idx}`} variant="outline" className="font-mono text-[10px]">
                          {`${citation.type || citation.source || 'source'}:${citation.id || citation.source_id || idx}`}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {aiAssistantAvailable && lintResult && (
              <div className={cn(
                "rounded-xl border p-4 space-y-3",
                hasLintForCurrentData ? "border-border bg-card" : "border-amber-200 bg-amber-50/70"
              )}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {lintResult.can_finalize === false ? (
                      <ShieldAlert className="size-4 text-rose-600" />
                    ) : (
                      <ShieldCheck className="size-4 text-emerald-600" />
                    )}
                    <p className="font-heading text-sm text-foreground">Quality Check Results</p>
                  </div>
                  {!hasLintForCurrentData && (
                    <Badge variant="outline" className="font-mono text-[10px] border-amber-200 bg-amber-50 text-amber-700">
                      Stale
                    </Badge>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className="font-mono text-[10px] border-rose-200 bg-rose-50 text-rose-700">
                    Critical {lintResult.issue_counts?.critical || 0}
                  </Badge>
                  <Badge variant="outline" className="font-mono text-[10px] border-amber-200 bg-amber-50 text-amber-700">
                    Major {lintResult.issue_counts?.major || 0}
                  </Badge>
                  <Badge variant="outline" className="font-mono text-[10px] border-sky-200 bg-sky-50 text-sky-700">
                    Minor {lintResult.issue_counts?.minor || 0}
                  </Badge>
                </div>

                {lintResult.review_message && (
                  <p className="text-xs text-muted-foreground">{lintResult.review_message}</p>
                )}

                {lintIssues.length > 0 && (
                  <div className="space-y-2">
                    {lintIssues.slice(0, 6).map((issue) => (
                      <div
                        key={`${issue.section_key || issue.section || 'general'}:${issue.severity}:${issue.message}`}
                        className="rounded-md border border-border/70 bg-background p-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                            {issue.severity} • {issue.section || issue.section_key}
                          </span>
                          {issue.blocking && (
                            <Badge variant="outline" className="font-mono text-[10px] border-rose-200 bg-rose-50 text-rose-700">
                              Blocking
                            </Badge>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-foreground">{issue.message}</p>
                        {issue.suggested_fix && (
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            Suggested fix: {issue.suggested_fix}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-12">
            <p className="text-muted-foreground mb-4">
              {isLoading ? 'Loading step...' : 'Unable to load workflow step.'}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={resetWorkflowAndAssistant}
              className="font-mono text-xs"
            >
              <ChevronLeft className="size-3.5 mr-1" />
              Back to Templates
            </Button>
          </div>
        )}
      </div>

      {/* Footer */}
      {template && (
        <footer className="px-6 py-3 border-t border-border bg-card">
          {/* Keyboard shortcuts hint */}
          <WorkflowKeyboardHints totalSteps={totalSteps} className="mb-3" />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleSaveDraft}
                disabled={isSaving || isLoading || isAiBusy}
                className="font-mono text-xs"
              >
                <Save className="size-3.5 mr-1.5" />
                Save Draft
              </Button>
              {aiAssistantAvailable && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRunQualityCheck}
                  disabled={isSaving || isLoading || isAiBusy}
                  className="font-mono text-xs"
                >
                  <ShieldCheck className="size-3.5 mr-1.5" />
                  Run Quality Check
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2">
              {currentStep > 1 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleBack}
                  disabled={isLoading || isAiBusy}
                  className="font-mono text-xs"
                >
                  <ChevronLeft className="size-3.5 mr-1" />
                  Previous
                </Button>
              )}

              {isLastStep && hasLintForCurrentData && lintResult?.requires_major_acknowledgement && (
	                <label htmlFor="add-note-major-acknowledgement" className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1">
	                  <Checkbox
	                    id="add-note-major-acknowledgement"
	                    checked={majorAcknowledged}
                    onCheckedChange={handleMajorAcknowledgementChange}
                  />
                  <span className="font-mono text-[10px] leading-tight text-amber-800">
                    Acknowledge major quality issues and continue.
                  </span>
                </label>
              )}

              {isLastStep ? (
                <Button
                  size="sm"
                  onClick={handleComplete}
                  disabled={isSaving || isLoading || isAiBusy || (!lintGate.canComplete && !lintGate.requiresLintRun)}
                  className="font-mono text-xs"
                >
                  <Check className="size-3.5 mr-1.5" />
                  {isEditMode ? 'Save Changes' : 'Complete Note'}
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={handleNext}
                  disabled={isLoading || isAiBusy}
                  className="font-mono text-xs"
                >
                  Next
                  <ChevronRight className="size-3.5 ml-1" />
                </Button>
              )}
            </div>
          </div>
        </footer>
      )}
    </>
  );
};

export default AddNoteSlideOver;
export { AddNoteSlideOver };
