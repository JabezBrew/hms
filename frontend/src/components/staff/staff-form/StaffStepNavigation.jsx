import { Badge } from '@/components/ui/badge';
import { TabsList, TabsTrigger } from '@/components/ui/tabs';

export function StaffStepNavigation({ activeStep, currentStepIndex, stepDefs, stepErrorCounts }) {
  return (
    <>
      <div className="mb-6 rounded-lg border border-border/60 bg-muted/20 p-3 sm:hidden">
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-[10px] uppercase text-muted-foreground">
            Step {currentStepIndex + 1} of {stepDefs.length}
          </p>
          {stepErrorCounts[activeStep] > 0 && (
            <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">
              {stepErrorCounts[activeStep]}
            </Badge>
          )}
        </div>
        <p className="mt-1 font-heading text-sm font-semibold text-foreground">
          {stepDefs[currentStepIndex]?.label || 'Staff details'}
        </p>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-border/70">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${((currentStepIndex + 1) / stepDefs.length) * 100}%` }}
          />
        </div>
      </div>

      <TabsList
        className="mb-6 hidden w-full sm:grid"
        style={{ gridTemplateColumns: `repeat(${stepDefs.length}, minmax(0, 1fr))` }}
      >
        {stepDefs.map((step, idx) => {
          const count = stepErrorCounts[step.key] || 0;
          return (
            <TabsTrigger key={step.key} value={step.key} className="font-mono text-xs">
              <span className="inline-flex items-center gap-2">
                <span className="inline-flex size-5 items-center justify-center rounded-full border border-border bg-card text-[10px]">
                  {idx + 1}
                </span>
                <span>{step.label}</span>
                {count > 0 && (
                  <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">
                    {count}
                  </Badge>
                )}
              </span>
            </TabsTrigger>
          );
        })}
      </TabsList>
    </>
  );
}
