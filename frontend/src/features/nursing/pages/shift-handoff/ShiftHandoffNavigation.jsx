import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right.js';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js';
import CheckCircle from 'lucide-react/dist/esm/icons/circle-check-big.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';

import { Button } from '@/components/ui/button';

export function ShiftHandoffNavigation({
  currentStep,
  canSubmit,
  isSubmitting,
  onBack,
  onCancel,
  onNext,
  onSubmit,
}) {
  return (
    <div className="flex items-center justify-between mt-6">
      <Button
        variant="outline"
        onClick={currentStep === 1 ? onCancel : onBack}
        className="font-mono"
      >
        <ArrowLeft className="mr-2 size-4" />
        {currentStep === 1 ? 'Cancel' : 'Back'}
      </Button>

      {currentStep < 4 ? (
        <Button
          onClick={onNext}
          className="font-mono bg-amber-500 hover:bg-amber-600 text-white"
        >
          Continue
          <ArrowRight className="ml-2 size-4" />
        </Button>
      ) : (
        <Button
          onClick={onSubmit}
          disabled={isSubmitting || !canSubmit}
          className="font-mono bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Submitting…
            </>
          ) : (
            <>
              <CheckCircle className="mr-2 size-4" />
              Complete Handoff
            </>
          )}
        </Button>
      )}
    </div>
  );
}
