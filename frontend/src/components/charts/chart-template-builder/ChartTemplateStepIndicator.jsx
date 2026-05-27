import Check from 'lucide-react/dist/esm/icons/check.js';

import { cn } from '@/lib/utils';

import { STEPS } from './chartTemplateBuilderOptions';

export function ChartTemplateStepIndicator({ currentStep, onGoToStep }) {
  return (
    <div className="px-6 py-4 bg-muted/30 border-b border-border">
      <div className="flex items-center justify-center gap-2">
        {STEPS.map((step, index) => {
          const isActive = currentStep === step.id;
          const isCompleted = currentStep > step.id;

          return (
            <div key={step.id} className="flex items-center">
              {index > 0 ? (
                <div
                  className={cn(
                    'h-px w-12 mx-2',
                    isCompleted ? 'bg-amber-500' : 'bg-border'
                  )}
                />
              ) : null}
              <button
                type="button"
                onClick={() => onGoToStep(step.id)}
                className={cn(
                  'flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all',
                  isActive && 'bg-amber-100 dark:bg-amber-900/30',
                  !isActive && 'hover:bg-muted'
                )}
              >
                <span
                  className={cn(
                    'size-6 rounded-full flex items-center justify-center text-xs font-mono',
                    isCompleted || isActive
                      ? 'bg-amber-500 text-white'
                      : 'bg-muted text-muted-foreground'
                  )}
                >
                  {isCompleted ? <Check className="size-3.5" /> : step.id}
                </span>
                <span
                  className={cn(
                    'font-mono text-xs hidden sm:inline',
                    isActive ? 'text-foreground' : 'text-muted-foreground'
                  )}
                >
                  {step.name}
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
