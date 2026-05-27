import CalendarIcon from 'lucide-react/dist/esm/icons/calendar.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export function AppointmentListEmptyState({ onCreateAppointment }) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-border bg-card/50 p-12 text-center',
        'animate-chronicle-enter'
      )}
    >
      <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-muted">
        <CalendarIcon className="size-8 text-muted-foreground" />
      </div>
      <h3 className="mb-2 font-display text-xl text-foreground">No Appointments Found</h3>
      <p className="mb-6 text-sm text-muted-foreground">
        No appointments match your current filters.
      </p>
      <Button onClick={onCreateAppointment} className="font-mono text-xs">
        <Plus className="mr-2 size-4" />
        Create New Appointment
      </Button>
    </div>
  );
}
