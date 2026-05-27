import { Card, CardContent } from '@/components/ui/card';

export function ShiftHandoffStepPanel({ currentStepDef, currentStep, totalSteps, children }) {
  const StepIcon = currentStepDef?.icon;

  return (
    <Card className="border-border">
      <CardContent className="p-6">
        <div className="mb-6 pb-4 border-b border-border">
          <div className="flex items-center gap-3">
            {StepIcon && (
              <div className="p-2 rounded-lg bg-amber-500/10">
                <StepIcon className="size-5 text-amber-600" />
              </div>
            )}
            <div>
              <h2 className="font-display text-xl font-semibold">
                {currentStepDef?.title}
              </h2>
              <p className="text-sm text-muted-foreground">
                Step {currentStep} of {totalSteps}
              </p>
            </div>
          </div>
        </div>

        <div className="min-h-[400px]">
          {children}
        </div>
      </CardContent>
    </Card>
  );
}
