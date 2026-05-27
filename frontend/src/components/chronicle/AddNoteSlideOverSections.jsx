import X from 'lucide-react/dist/esm/icons/x.js';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import Save from 'lucide-react/dist/esm/icons/save.js';
import Check from 'lucide-react/dist/esm/icons/check.js';
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles.js';
import ShieldCheck from 'lucide-react/dist/esm/icons/shield-check.js';
import ShieldAlert from 'lucide-react/dist/esm/icons/shield-alert.js';

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { WorkflowSteps, WorkflowKeyboardHints } from "@/components/ui/workflow-steps";
import NoteTypeSelector from "./NoteTypeSelector";
import DynamicWorkflowStep from "./DynamicWorkflowStep";

function TemplateBadge({ categoryColor, template }) {
  if (!template) {
    return null;
  }

  return (
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
  );
}

function AddNoteHeader({
  categoryColor,
  isEditMode,
  onClose,
  patientName,
  template,
  workflowStatus,
}) {
  const { isLoading, isSaving, lastSaved } = workflowStatus;

  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
      <div className="flex items-center gap-3">
        <div>
          <div className="flex items-center gap-2">
            <TemplateBadge categoryColor={categoryColor} template={template} />
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

        <Button
          variant="destructive"
          size="sm"
          onClick={onClose}
          className="font-mono text-xs bg-red-500 hover:bg-red-600 text-white"
        >
          <X className="size-4 mr-1.5" />
          Close
        </Button>
      </div>
    </header>
  );
}

function AddNoteErrorAlert({ error, onReset, template }) {
  if (!error) {
    return null;
  }

  return (
    <Alert variant="destructive" className="mx-6 mt-4">
      <AlertCircle className="size-4" />
      <AlertDescription className="flex items-center justify-between">
        <span>{error}</span>
        {template && (
          <Button
            variant="outline"
            size="sm"
            onClick={onReset}
            className="ml-4 font-mono text-xs"
          >
            <ChevronLeft className="size-3.5 mr-1" />
            Back
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

function AddNoteProgress({ currentStep, onGoToStep, onReset, steps, template, totalSteps }) {
  if (!template || steps.length === 0 || currentStep <= 0) {
    return null;
  }

  return (
    <div className="px-6 py-3 bg-muted/30 border-b border-border">
      <div className="flex items-center justify-between mb-3">
        <button
          type="button"
          onClick={onReset}
          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors font-mono text-xs"
        >
          <ChevronLeft className="size-3.5" />
          Change Note Type
        </button>
        <span className="font-mono text-xs text-muted-foreground">
          Step {currentStep} of {totalSteps}
        </span>
      </div>
      <WorkflowSteps
        steps={steps}
        currentStep={currentStep}
        onStepClick={onGoToStep}
      />
    </div>
  );
}

function AINoteAssistantCard({
  aiStatus,
  draftPrompt,
  onDraftPromptChange,
  onGenerateDraft,
  onRunQualityCheck,
}) {
  const { hasLintForCurrentData, isAiBusy, lintResult } = aiStatus;

  return (
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
          onChange={onDraftPromptChange}
          placeholder="Optional draft focus (e.g., 'post-op handoff')"
          className="h-8 font-mono text-xs"
          disabled={isAiBusy}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onGenerateDraft}
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
          onClick={onRunQualityCheck}
          disabled={isAiBusy}
          className="font-mono text-xs"
        >
          <ShieldCheck className="size-3.5 mr-1.5" />
          Run Quality Check
        </Button>
      </div>
    </div>
  );
}

function SectionDiffCard({ currentStepCitations, currentStepDiff }) {
  return (
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
          {currentStepDiff.segments.map((segment) => (
            <span
              key={`${segment.added ? 'added' : segment.removed ? 'removed' : 'same'}:${segment.value}`}
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
            {currentStepCitations.map((citation) => {
              const source = citation.type || citation.source || 'source';
              const id = citation.id || citation.source_id || citation.label || 'unknown';
              return (
                <Badge key={`${source}:${id}`} variant="outline" className="font-mono text-[10px]">
                  {`${source}:${id}`}
                </Badge>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function QualityCheckResultsCard({ aiStatus }) {
  const { hasLintForCurrentData, lintIssues, lintResult } = aiStatus;

  return (
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
  );
}

function WorkflowStepContent({
  aiAssistantAvailable,
  aiStatus,
  currentStepConfig,
  currentStepCitations,
  currentStepDiff,
  currentStepDraftText,
  draftPrompt,
  formData,
  onDraftPromptChange,
  onGenerateDraft,
  onRunQualityCheck,
  onStepDataChange,
  patient,
  template,
}) {
  return (
    <div className="space-y-4">
      {aiAssistantAvailable && (
        <AINoteAssistantCard
          aiStatus={aiStatus}
          draftPrompt={draftPrompt}
          onDraftPromptChange={onDraftPromptChange}
          onGenerateDraft={onGenerateDraft}
          onRunQualityCheck={onRunQualityCheck}
        />
      )}

      <DynamicWorkflowStep
        stepConfig={currentStepConfig}
        formData={formData[currentStepConfig.id] || {}}
        onDataChange={onStepDataChange}
        patient={patient}
        template={template}
      />

      {aiAssistantAvailable && currentStepDraftText && (
        <SectionDiffCard
          currentStepCitations={currentStepCitations}
          currentStepDiff={currentStepDiff}
        />
      )}

      {aiAssistantAvailable && aiStatus.lintResult && (
        <QualityCheckResultsCard aiStatus={aiStatus} />
      )}
    </div>
  );
}

function AddNoteContent({
  aiAssistantAvailable,
  aiStatus,
  currentStepConfig,
  currentStepCitations,
  currentStepDiff,
  currentStepDraftText,
  draftPrompt,
  formData,
  isLoading,
  onDraftPromptChange,
  onGenerateDraft,
  onReset,
  onRunQualityCheck,
  onSelectTemplate,
  onStepDataChange,
  open,
  patient,
  template,
}) {
  return (
    <div className="flex-1 overflow-y-auto p-6 chronicle-scrollbar">
      {!template ? (
        <NoteTypeSelector onSelect={onSelectTemplate} enabled={open} />
      ) : currentStepConfig ? (
        <WorkflowStepContent
          aiAssistantAvailable={aiAssistantAvailable}
          aiStatus={aiStatus}
          currentStepConfig={currentStepConfig}
          currentStepCitations={currentStepCitations}
          currentStepDiff={currentStepDiff}
          currentStepDraftText={currentStepDraftText}
          draftPrompt={draftPrompt}
          formData={formData}
          onDraftPromptChange={onDraftPromptChange}
          onGenerateDraft={onGenerateDraft}
          onRunQualityCheck={onRunQualityCheck}
          onStepDataChange={onStepDataChange}
          patient={patient}
          template={template}
        />
      ) : (
        <div className="text-center py-12">
          <p className="text-muted-foreground mb-4">
            {isLoading ? 'Loading step...' : 'Unable to load workflow step.'}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={onReset}
            className="font-mono text-xs"
          >
            <ChevronLeft className="size-3.5 mr-1" />
            Back to Templates
          </Button>
        </div>
      )}
    </div>
  );
}

function MajorAcknowledgement({ acknowledgement }) {
  const {
    hasLintForCurrentData,
    isLastStep,
    lintResult,
    majorAcknowledged,
    onMajorAcknowledgementChange,
  } = acknowledgement;

  if (!isLastStep || !hasLintForCurrentData || !lintResult?.requires_major_acknowledgement) {
    return null;
  }

  return (
    <label htmlFor="add-note-major-acknowledgement" className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1">
      <Checkbox
        id="add-note-major-acknowledgement"
        checked={majorAcknowledged}
        onCheckedChange={onMajorAcknowledgementChange}
      />
      <span className="font-mono text-[10px] leading-tight text-amber-800">
        Acknowledge major quality issues and continue.
      </span>
    </label>
  );
}

function AddNoteFooter({
  aiAssistantAvailable,
  aiStatus,
  currentStep,
  isEditMode,
  lintGate,
  onBack,
  onComplete,
  onNext,
  onRunQualityCheck,
  onSaveDraft,
  template,
  totalSteps,
  workflowStatus,
}) {
  if (!template) {
    return null;
  }

  const { isLastStep, isLoading, isSaving } = workflowStatus;
  const { isAiBusy } = aiStatus;

  return (
    <footer className="px-6 py-3 border-t border-border bg-card">
      <WorkflowKeyboardHints totalSteps={totalSteps} className="mb-3" />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onSaveDraft}
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
              onClick={onRunQualityCheck}
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
              onClick={onBack}
              disabled={isLoading || isAiBusy}
              className="font-mono text-xs"
            >
              <ChevronLeft className="size-3.5 mr-1" />
              Previous
            </Button>
          )}

          <MajorAcknowledgement
            acknowledgement={{
              hasLintForCurrentData: aiStatus.hasLintForCurrentData,
              isLastStep,
              lintResult: aiStatus.lintResult,
              majorAcknowledged: aiStatus.majorAcknowledged,
              onMajorAcknowledgementChange: aiStatus.onMajorAcknowledgementChange,
            }}
          />

          {isLastStep ? (
            <Button
              size="sm"
              onClick={onComplete}
              disabled={isSaving || isLoading || isAiBusy || (!lintGate.canComplete && !lintGate.requiresLintRun)}
              className="font-mono text-xs"
            >
              <Check className="size-3.5 mr-1.5" />
              {isEditMode ? 'Save Changes' : 'Complete Note'}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={onNext}
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
  );
}

export function AddNoteWorkflowPanel({
  aiAssistantAvailable,
  aiStatus,
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
  onBack,
  onClose,
  onComplete,
  onDraftPromptChange,
  onGenerateDraft,
  onGoToStep,
  onNext,
  onReset,
  onRunQualityCheck,
  onSaveDraft,
  onSelectTemplate,
  onStepDataChange,
  open,
  patient,
  patientName,
  steps,
  template,
  totalSteps,
  workflowStatus,
}) {
  return (
    <>
      <AddNoteHeader
        categoryColor={categoryColor}
        isEditMode={isEditMode}
        onClose={onClose}
        patientName={patientName}
        template={template}
        workflowStatus={workflowStatus}
      />

      <AddNoteErrorAlert
        error={error}
        onReset={onReset}
        template={template}
      />

      <AddNoteProgress
        currentStep={currentStep}
        onGoToStep={onGoToStep}
        onReset={onReset}
        steps={steps}
        template={template}
        totalSteps={totalSteps}
      />

      <AddNoteContent
        aiAssistantAvailable={aiAssistantAvailable}
        aiStatus={aiStatus}
        currentStepConfig={currentStepConfig}
        currentStepCitations={currentStepCitations}
        currentStepDiff={currentStepDiff}
        currentStepDraftText={currentStepDraftText}
        draftPrompt={draftPrompt}
        formData={formData}
        isLoading={workflowStatus.isLoading}
        onDraftPromptChange={onDraftPromptChange}
        onGenerateDraft={onGenerateDraft}
        onReset={onReset}
        onRunQualityCheck={onRunQualityCheck}
        onSelectTemplate={onSelectTemplate}
        onStepDataChange={onStepDataChange}
        open={open}
        patient={patient}
        template={template}
      />

      <AddNoteFooter
        aiAssistantAvailable={aiAssistantAvailable}
        aiStatus={aiStatus}
        currentStep={currentStep}
        isEditMode={isEditMode}
        lintGate={lintGate}
        onBack={onBack}
        onComplete={onComplete}
        onNext={onNext}
        onRunQualityCheck={onRunQualityCheck}
        onSaveDraft={onSaveDraft}
        template={template}
        totalSteps={totalSteps}
        workflowStatus={workflowStatus}
      />
    </>
  );
}
