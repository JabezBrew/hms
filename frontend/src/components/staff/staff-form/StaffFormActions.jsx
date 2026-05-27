import { Button } from '@/components/ui/button';

export function StaffFormActions({
  isFirstStep,
  isLastStep,
  isSubmitting,
  onBack,
  onNext,
}) {
  return (
    <div className="flex items-center justify-between pt-6">
      <Button
        type="button"
        variant="outline"
        onClick={onBack}
        disabled={isFirstStep || isSubmitting}
        className="font-mono text-sm"
      >
        Back
      </Button>

      {!isLastStep ? (
        <Button
          type="button"
          onClick={onNext}
          disabled={isSubmitting}
          className="font-mono text-sm bg-primary hover:bg-primary/90"
        >
          Next
        </Button>
      ) : (
        <Button
          type="submit"
          disabled={isSubmitting}
          className="font-mono text-sm bg-primary hover:bg-primary/90"
        >
          {isSubmitting ? 'Saving…' : 'Create Staff Member'}
        </Button>
      )}
    </div>
  );
}
