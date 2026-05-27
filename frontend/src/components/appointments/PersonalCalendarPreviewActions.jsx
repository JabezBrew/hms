import Eye from 'lucide-react/dist/esm/icons/eye.js';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

export function PersonalCalendarPreviewActions({
  isEditing,
  isPreviewLoading,
  isPreviewOpen,
  onPreview,
  previewData,
  setIsPreviewOpen,
  submitting,
}) {
  return (
    <div className="flex items-center justify-between pt-2 border-t border-border">
      <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <DialogTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="font-mono text-xs"
            onClick={onPreview}
            disabled={isPreviewLoading}
          >
            {isPreviewLoading ? (
              <>Generating&hellip;</>
            ) : (
              <>
                <Eye className="mr-1.5 size-3.5" />
                Preview Slots
              </>
            )}
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-[500px] z-[300]">
          <DialogHeader>
            <DialogTitle className="font-display text-lg">Slot Preview</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Preview of slots generated based on current settings (for a single day).
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[300px] overflow-y-auto pr-2">
            {previewData && previewData.length > 0 ? (
              <div className="grid grid-cols-3 gap-2">
                {previewData.map((slot) => (
                  <div
                    key={`${slot.start}-${slot.end}`}
                    className="font-mono text-xs bg-muted/50 px-2 py-1.5 rounded text-center border border-border"
                  >
                    {slot.start} - {slot.end}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-xs text-muted-foreground">
                No slots generated. Check your time range and breaks.
              </div>
            )}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mt-2">
            Total slots: {previewData?.length || 0}
          </div>
        </DialogContent>
      </Dialog>

      <Button
        type="submit"
        disabled={submitting}
        className="bg-amber-600 hover:bg-amber-700 font-mono text-xs"
      >
        {submitting ? 'Saving...' : isEditing ? 'Update Rule' : 'Create Rule'}
      </Button>
    </div>
  );
}
