import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import format from 'date-fns/format';

import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';

export function AvailabilityCalendarPanel({
  availableDates,
  currentMonth,
  goToNextMonth,
  goToPreviousMonth,
  handleSelect,
  isLoading,
  selectedDate,
  setCurrentMonth,
  unavailableDates,
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border/50 p-4">
        <div className="mb-4 flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={goToPreviousMonth}
            className="size-8 p-0"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <h3 className="font-semibold text-foreground">
            {format(currentMonth, 'MMMM yyyy')}
          </h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={goToNextMonth}
            className="size-8 p-0"
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>

        {isLoading ? (
          <div className="flex h-[300px] items-center justify-center">
            <LoadingSpinner className="size-8 text-muted-foreground" />
          </div>
        ) : (
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={handleSelect}
            month={currentMonth}
            onMonthChange={setCurrentMonth}
            className="flex w-full justify-center"
            modifiers={{
              available: availableDates,
              unavailable: unavailableDates,
            }}
            modifiersClassNames={{
              available: 'bg-emerald-500/20 text-emerald-700 font-medium hover:bg-emerald-500/30 dark:text-emerald-400',
              unavailable: 'bg-rose-500/10 text-rose-700/50 font-medium cursor-not-allowed dark:text-rose-400/50',
              selected: 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground',
            }}
          />
        )}
      </div>

      <div className="flex items-center justify-center gap-6 text-sm">
        <div className="flex items-center gap-2">
          <div className="size-3 rounded-full border border-emerald-500/50 bg-emerald-500/30" />
          <span className="text-muted-foreground">Available</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="size-3 rounded-full border border-rose-500/30 bg-rose-500/20" />
          <span className="text-muted-foreground">Unavailable</span>
        </div>
      </div>
    </div>
  );
}
