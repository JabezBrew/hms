import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right.js';
import CheckCircle from 'lucide-react/dist/esm/icons/circle-check-big.js';

import { cn } from '@/lib/utils';

export function ShiftHandoffProgress({ steps, currentStep, isStepComplete, onStepSelect }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {steps.map((step, index) => {
        const Icon = step.icon;
        const isActive = currentStep === step.id;
        const isCompleted = isStepComplete(step.id);

        return (
          <div key={step.id} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onStepSelect(step.id)}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg transition-all cursor-pointer",
                isActive && "bg-amber-500 text-white",
                isCompleted && !isActive && "bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20",
                !isActive && !isCompleted && "bg-muted text-muted-foreground hover:bg-muted/80"
              )}
            >
              {isCompleted && !isActive ? (
                <CheckCircle className="size-4" />
              ) : (
                <Icon className="size-4" />
              )}
              <span className="font-mono text-xs uppercase tracking-wide hidden sm:inline">
                {step.title}
              </span>
            </button>

            {index < steps.length - 1 && (
              <ArrowRight className={cn(
                "size-4",
                isCompleted ? "text-emerald-500" : "text-muted-foreground/30"
              )} />
            )}
          </div>
        );
      })}
    </div>
  );
}
