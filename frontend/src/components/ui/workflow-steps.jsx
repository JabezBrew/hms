import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * WorkflowSteps - Reusable clickable step indicator for multi-step workflows
 *
 * Features:
 * - Clickable step indicators with visual feedback
 * - Tooltips with step info and keyboard shortcuts
 * - Completed/current/pending states
 * - Accessible with ARIA labels
 * - Keyboard navigation support (⌘1-9 to jump to step)
 *
 * Usage:
 * ```jsx
 * <WorkflowSteps
 *   steps={[{ id: 'step1', title: 'First Step' }, { id: 'step2', title: 'Second Step' }]}
 *   currentStep={1}
 *   onStepClick={(stepNumber) => goToStep(stepNumber)}
 * />
 * ```
 */
const WorkflowSteps = ({
  steps,
  currentStep,
  onStepClick,
  className,
  showKeyboardHints = true,
}) => {
  if (!steps || steps.length === 0) return null;

  return (
    <TooltipProvider delayDuration={300}>
      <div className={cn("flex items-center justify-between", className)}>
        {steps.map((step, index) => {
          const stepNumber = index + 1;
          const isCompleted = index < currentStep - 1;
          const isCurrent = index === currentStep - 1;
          const isPending = index > currentStep - 1;

          return (
            <div
              key={step.id}
              className={cn(
                "flex items-center",
                index < steps.length - 1 && "flex-1"
              )}
            >
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => onStepClick?.(stepNumber)}
                    className={cn(
                      "flex items-center gap-2 group transition-all",
                      "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-lg p-1 -m-1"
                    )}
                    aria-label={`Go to step ${stepNumber}: ${step.title}`}
                    aria-current={isCurrent ? "step" : undefined}
                  >
                    <div
                      className={cn(
                        "w-6 h-6 rounded-full flex items-center justify-center text-xs font-mono transition-all",
                        isCompleted &&
                          "bg-primary text-primary-foreground group-hover:ring-2 group-hover:ring-primary/50",
                        isCurrent &&
                          "bg-primary text-primary-foreground ring-2 ring-primary/30",
                        isPending &&
                          "bg-muted text-muted-foreground group-hover:bg-muted/80 group-hover:ring-2 group-hover:ring-muted-foreground/30"
                      )}
                    >
                      {isCompleted ? (
                        <Check className="h-3 w-3" />
                      ) : (
                        stepNumber
                      )}
                    </div>
                    <span
                      className={cn(
                        "font-mono text-xs hidden sm:inline truncate max-w-[80px] transition-colors",
                        isCurrent
                          ? "text-foreground"
                          : "text-muted-foreground group-hover:text-foreground"
                      )}
                    >
                      {step.title}
                    </span>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="font-mono text-xs">
                  <p>{step.title}</p>
                  <p className="text-muted-foreground text-[10px] mt-0.5">
                    {isCurrent
                      ? "Current step"
                      : isCompleted
                        ? "Completed"
                        : "Click to jump"}
                    {showKeyboardHints && stepNumber <= 9 && (
                      <>{" · "}⌘{stepNumber}</>
                    )}
                  </p>
                </TooltipContent>
              </Tooltip>
              {index < steps.length - 1 && (
                <div
                  className={cn(
                    "flex-1 h-px mx-3",
                    isCompleted ? "bg-primary" : "bg-border"
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
    </TooltipProvider>
  );
};

/**
 * WorkflowKeyboardHints - Subtle keyboard shortcuts bar for workflow navigation
 *
 * Usage:
 * ```jsx
 * <WorkflowKeyboardHints totalSteps={4} />
 * ```
 */
const WorkflowKeyboardHints = ({ totalSteps, className }) => {
  return (
    <div
      className={cn(
        "flex items-center justify-center gap-4 text-[10px] font-mono text-muted-foreground/60",
        className
      )}
    >
      <span>
        <kbd className="px-1 py-0.5 bg-muted rounded text-[9px]">Tab</kbd> next
        field
      </span>
      <span>
        <kbd className="px-1 py-0.5 bg-muted rounded text-[9px]">PgDn</kbd> next
        step
      </span>
      <span>
        <kbd className="px-1 py-0.5 bg-muted rounded text-[9px]">
          ⌘1-{totalSteps}
        </kbd>{" "}
        jump to step
      </span>
      <span>
        <kbd className="px-1 py-0.5 bg-muted rounded text-[9px]">Esc</kbd> close
      </span>
    </div>
  );
};

/**
 * useWorkflowKeyboard - Hook for workflow keyboard navigation
 *
 * Handles:
 * - PageUp/PageDown for step navigation
 * - Ctrl/Cmd + Arrow keys for step navigation
 * - Ctrl/Cmd + 1-9 for direct step jump
 * - Ctrl + Enter to advance/complete
 * - Escape to close
 *
 * Usage:
 * ```jsx
 * useWorkflowKeyboard({
 *   enabled: open && !!template,
 *   currentStep,
 *   totalSteps,
 *   onNextStep: nextStep,
 *   onPrevStep: prevStep,
 *   onGoToStep: goToStep,
 *   onComplete: completeWorkflow,
 *   onClose: handleClose,
 * });
 * ```
 */
const useWorkflowKeyboard = ({
  enabled = true,
  currentStep,
  totalSteps,
  onNextStep,
  onPrevStep,
  onGoToStep,
  onComplete,
  onClose,
}) => {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e) => {
      // Don't intercept if user is typing in an input/textarea
      const isTyping =
        ["INPUT", "TEXTAREA"].includes(e.target.tagName) && !e.target.readOnly;

      // Step navigation: Ctrl/Cmd + Arrow keys or Page Up/Down
      if (
        e.key === "PageDown" ||
        (e.ctrlKey && e.key === "ArrowRight") ||
        (e.metaKey && e.key === "ArrowRight")
      ) {
        e.preventDefault();
        if (currentStep < totalSteps) {
          onNextStep?.();
        }
      } else if (
        e.key === "PageUp" ||
        (e.ctrlKey && e.key === "ArrowLeft") ||
        (e.metaKey && e.key === "ArrowLeft")
      ) {
        e.preventDefault();
        if (currentStep > 1) {
          onPrevStep?.();
        }
      }
      // Quick step jump: Ctrl/Cmd + number (1-9)
      else if ((e.ctrlKey || e.metaKey) && e.key >= "1" && e.key <= "9") {
        const stepNum = parseInt(e.key, 10);
        if (stepNum <= totalSteps) {
          e.preventDefault();
          onGoToStep?.(stepNum);
        }
      }
      // Enter to complete/advance (when not in textarea)
      else if (e.key === "Enter" && e.ctrlKey && !isTyping) {
        e.preventDefault();
        if (currentStep === totalSteps) {
          onComplete?.();
        } else {
          onNextStep?.();
        }
      }
      // Escape to close
      else if (e.key === "Escape" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        onClose?.();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    enabled,
    currentStep,
    totalSteps,
    onNextStep,
    onPrevStep,
    onGoToStep,
    onComplete,
    onClose,
  ]);
};

export { WorkflowSteps, WorkflowKeyboardHints, useWorkflowKeyboard };
