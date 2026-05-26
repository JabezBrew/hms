
import CheckCircle from 'lucide-react/dist/esm/icons/circle-check-big.js';
import Circle from 'lucide-react/dist/esm/icons/circle.js';
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right.js';
import { cn } from '@/lib/utils';

/**
 * WorkflowProgress Component
 * Displays step progress indicator
 */
export function WorkflowProgress({ steps, currentStep, className }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      {steps.map((step, index) => (
        <div key={step.id} className="flex items-center gap-2">
          <div
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-lg transition-colors",
              step.id === currentStep && "bg-primary text-primary-foreground",
              step.id < currentStep && "bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400",
              step.id > currentStep && "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
            )}
          >
            {step.id < currentStep ? (
              <CheckCircle className="size-4" />
            ) : (
              <Circle className={cn(
                "size-4",
                step.id > currentStep && "opacity-30"
              )} />
            )}
            <span className="text-sm font-medium">{step.title}</span>
          </div>

          {index < steps.length - 1 && (
            <ArrowRight className="size-4 text-muted-foreground" />
          )}
        </div>
      ))}
    </div>
  );
}
