import Minimize2 from 'lucide-react/dist/esm/icons/minimize-2.js'
import Maximize2 from 'lucide-react/dist/esm/icons/maximize-2.js'
import ArrowUpRight from 'lucide-react/dist/esm/icons/arrow-up-right.js'
import SkipForward from 'lucide-react/dist/esm/icons/skip-forward.js'
import Compass from 'lucide-react/dist/esm/icons/compass.js'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { useOnboardingRuntime } from '../hooks/useOnboardingRuntime'

export default function OnboardingRuntime() {
  const {
    shouldRender,
    isLoading,
    flowTitle,
    flowDescription,
    currentStep,
    completedCount,
    totalSteps,
    progressPercent,
    isMutating,
    openCurrentStep,
    skipCurrentStep,
  } = useOnboardingRuntime()

  const [collapsed, setCollapsed] = useState(false)

  if (isLoading || !shouldRender) {
    return null
  }

  return (
    <aside className="fixed bottom-4 right-4 z-[90] w-[22rem] max-w-[calc(100vw-1rem)]">
      <Card className="border-amber-500/30 bg-card/95 shadow-xl backdrop-blur">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-600">
                Guided Onboarding
              </p>
              <CardTitle className="font-heading text-sm leading-tight">
                {flowTitle}
              </CardTitle>
              {!collapsed && flowDescription && (
                <p className="mt-1 text-xs text-muted-foreground">{flowDescription}</p>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={() => setCollapsed((value) => !value)}
              aria-label={collapsed ? 'Expand onboarding panel' : 'Collapse onboarding panel'}
            >
              {collapsed ? <Maximize2 className="h-3.5 w-3.5" /> : <Minimize2 className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </CardHeader>
        {!collapsed && (
          <CardContent className="space-y-3 pt-0">
            <div>
              <div className="mb-1 flex items-center justify-between font-mono text-[11px] text-muted-foreground">
                <span>
                  Step {Math.min(completedCount + 1, totalSteps)} of {totalSteps}
                </span>
                <span>{progressPercent}%</span>
              </div>
              <Progress value={progressPercent} indicatorClassName="bg-amber-500" />
            </div>

            <div className="rounded-lg border border-border/70 bg-muted/25 p-3">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <Compass className="h-3.5 w-3.5 text-amber-600" />
                {currentStep.title}
              </div>
              {currentStep.description && (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {currentStep.description}
                </p>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="flex-1 font-mono text-xs"
                onClick={openCurrentStep}
                disabled={isMutating || !currentStep?.action?.route}
              >
                {currentStep?.action?.label || 'Open Step'}
                <ArrowUpRight className="ml-1.5 h-3.5 w-3.5" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="font-mono text-xs"
                onClick={() => {
                  void skipCurrentStep()
                }}
                disabled={isMutating}
              >
                <SkipForward className="mr-1.5 h-3.5 w-3.5" />
                Skip
              </Button>
            </div>
          </CardContent>
        )}
      </Card>
    </aside>
  )
}
