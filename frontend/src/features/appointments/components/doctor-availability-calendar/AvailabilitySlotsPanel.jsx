import CalendarCheck from 'lucide-react/dist/esm/icons/calendar-check.js';
import CalendarX from 'lucide-react/dist/esm/icons/calendar-x.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import format from 'date-fns/format';

import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';

import { slotAvailability } from './availabilityUtils';

const LOADING_SLOT_KEYS = ['first', 'second', 'third', 'fourth'];

function SlotCapacityBadge({ availability, isBooked }) {
  if (availability.max > 1 && availability.remaining > 0) {
    return (
      <Badge
        variant="secondary"
        className="bg-emerald-500/10 px-1.5 py-0 text-[10px] text-emerald-700"
      >
        {`${availability.remaining}/${availability.max} left`}
      </Badge>
    );
  }

  if (availability.overbook) {
    return (
      <Badge variant="secondary" className="bg-amber-500/10 px-1.5 py-0 text-[10px] text-amber-700">
        Overbook
      </Badge>
    );
  }

  if (isBooked) {
    return (
      <Badge variant="secondary" className="bg-rose-500/10 px-1.5 py-0 text-[10px] text-rose-600">
        Full
      </Badge>
    );
  }

  return null;
}

function AvailabilitySlotButton({ isSelected, onClick, slot }) {
  const availability = slotAvailability(slot);
  const isBooked = !availability.selectable;

  return (
    <button
      type="button"
      onClick={() => onClick(slot)}
      disabled={isBooked}
      className={cn(
        'flex items-center justify-between rounded-lg border p-3 text-left transition-all',
        isBooked
          ? 'cursor-not-allowed border-rose-500/20 bg-rose-500/5 text-rose-600/60'
          : availability.overbook
            ? 'cursor-pointer border-amber-500/30 bg-amber-500/5 text-amber-700 hover:border-amber-500/50 hover:bg-amber-500/10 dark:text-amber-300'
            : 'cursor-pointer border-emerald-500/20 bg-emerald-500/5 text-emerald-700 hover:border-emerald-500/40 hover:bg-emerald-500/10 dark:text-emerald-400',
        isSelected && !isBooked && 'ring-2 ring-primary ring-offset-2'
      )}
    >
      <div className="flex items-center gap-2">
        <Clock className={cn(
          'size-4',
          isBooked ? 'text-rose-400' : availability.overbook ? 'text-amber-500' : 'text-emerald-500'
        )} />
        <span className="font-mono text-sm">
          {format(new Date(slot.start), 'h:mm a')} - {format(new Date(slot.end), 'h:mm a')}
        </span>
      </div>
      <SlotCapacityBadge availability={availability} isBooked={isBooked} />
    </button>
  );
}

function AvailabilitySlotsLoading() {
  return (
    <div className="space-y-2">
      {LOADING_SLOT_KEYS.map((key) => (
        <Skeleton key={key} className="h-12 w-full" />
      ))}
    </div>
  );
}

function AvailabilitySlotsEmpty() {
  return (
    <div className="flex h-[200px] flex-col items-center justify-center rounded-xl border border-border/50 bg-muted/20">
      <Clock className="mb-3 size-10 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">No slots for this date</p>
      <p className="mt-1 text-xs text-muted-foreground/60">
        Select an available day on the calendar
      </p>
    </div>
  );
}

export function AvailabilitySlotsPanel({
  capacitySummary,
  handleSlotClick,
  isLoading,
  selectedDate,
  selectedDateSlots,
  selectedSlotId,
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-foreground">
            {format(selectedDate, 'EEEE, MMMM d')}
          </h3>
          <p className="text-sm text-muted-foreground">
            {selectedDateSlots.length > 0
              ? `${capacitySummary.totalRemaining} remaining, ${capacitySummary.totalBooked} booked${capacitySummary.totalOverbookRemaining > 0 ? `, ${capacitySummary.totalOverbookRemaining} overbook` : ''}`
              : 'No scheduled slots'
            }
          </p>
        </div>
        {selectedDateSlots.length > 0 && (
          <div className="flex gap-2">
            <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600">
              <CalendarCheck className="mr-1 size-3" />
              {capacitySummary.totalRemaining}
            </Badge>
            <Badge variant="outline" className="border-rose-500/30 bg-rose-500/10 text-rose-600">
              <CalendarX className="mr-1 size-3" />
              {capacitySummary.totalBooked}
            </Badge>
          </div>
        )}
      </div>

      {isLoading ? (
        <AvailabilitySlotsLoading />
      ) : selectedDateSlots.length > 0 ? (
        <ScrollArea className="h-[350px] rounded-xl border border-border/50 p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {selectedDateSlots.map((slot) => (
              <AvailabilitySlotButton
                key={slot.id}
                isSelected={selectedSlotId === slot.id}
                onClick={handleSlotClick}
                slot={slot}
              />
            ))}
          </div>
        </ScrollArea>
      ) : (
        <AvailabilitySlotsEmpty />
      )}
    </div>
  );
}
