import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';

import { Button } from '@/components/ui/button';

export function AppointmentCreateHeader({
  isWaitlistPromotion,
  onBack,
  progress,
}) {
  return (
    <div className="shrink-0 border-b border-border bg-card/50">
      <div className="px-6 py-3">
        <div className="flex items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
              className="-ml-2 font-mono text-xs"
            >
              <ChevronLeft className="mr-1 size-4" />
              Back
            </Button>
            <div className="h-6 w-px bg-border" />
            <div className="flex items-center gap-2">
              <Calendar className="size-5 text-primary" />
              <h1 className="font-display text-lg text-foreground">
                {isWaitlistPromotion ? 'Promote Waitlist Entry' : 'Schedule Appointment'}
              </h1>
            </div>
          </div>

          <div className="w-56 hidden sm:block">
            <div className="flex items-center justify-between mb-1 text-xs font-mono text-muted-foreground">
              <span>Setup progress</span>
              <span>{progress.completed}/{progress.total}</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${(progress.completed / progress.total) * 100}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
