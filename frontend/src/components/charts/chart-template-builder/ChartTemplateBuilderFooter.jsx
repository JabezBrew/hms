import Check from 'lucide-react/dist/esm/icons/check.js';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';

import { Button } from '@/components/ui/button';

export function ChartTemplateBuilderFooter({
  currentStep,
  hasChanges,
  isSaving,
  templateId,
  onPrevious,
  onNext,
  onSave,
}) {
  return (
    <footer className="px-6 py-4 border-t border-border bg-card">
      <div className="flex items-center justify-between max-w-3xl mx-auto">
        <Button
          variant="outline"
          size="sm"
          onClick={onPrevious}
          disabled={currentStep === 1}
          className="font-mono text-xs"
        >
          <ChevronLeft className="size-3.5 mr-1" />
          Previous
        </Button>

        <div className="flex items-center gap-2">
          {hasChanges ? (
            <span className="font-mono text-[10px] text-muted-foreground">
              Unsaved changes
            </span>
          ) : null}
          {currentStep < 4 ? (
            <Button
              size="sm"
              onClick={onNext}
              className="font-mono text-xs bg-amber-600 hover:bg-amber-700"
            >
              Next
              <ChevronRight className="size-3.5 ml-1" />
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={onSave}
              disabled={isSaving}
              className="font-mono text-xs bg-amber-600 hover:bg-amber-700"
            >
              {isSaving ? (
                <>
                  <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <Check className="size-3.5 mr-1.5" />
                  {templateId ? 'Update Template' : 'Create Template'}
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </footer>
  );
}
