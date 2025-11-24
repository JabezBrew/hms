import { useState, useMemo } from 'react';
import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  format,
  startOfMonth,
  endOfMonth,
  addMonths,
  subMonths,
  startOfWeek,
  endOfWeek,
  isBefore,
  startOfDay,
  isSameDay,
  parseISO,
  isWithinInterval
} from 'date-fns';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import {
  useAvailableSlots,
  useRecurringSchedules,
  useBlockedTimes
} from '@/hooks/useAppointmentQueries';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';

/**
 * DoctorAvailabilityCalendar component
 * Displays a calendar with availability and a list of slots for the selected date.
 *
 * @param {Object} props - Component props
 * @param {string} props.practitionerId - The ID of the practitioner
 * @param {Function} props.onSlotSelect - Callback when a slot is selected
 */
const DoctorAvailabilityCalendar = ({
  practitionerId,
  onSlotSelect,
}) => {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());

  // Calculate the visible date range for the calendar grid
  const calendarStart = startOfWeek(startOfMonth(currentMonth));
  const calendarEnd = endOfWeek(endOfMonth(currentMonth));

  const dateRangeParams = {
    practitioner_id: practitionerId,
    start_date: format(calendarStart, 'yyyy-MM-dd'),
    end_date: format(calendarEnd, 'yyyy-MM-dd'),
  };

  // Fetch data
  const { data: slotsData, isLoading: slotsLoading } = useAvailableSlots({
    ...dateRangeParams,
    // Fetch all slots to show booked ones too
  });

  const { data: recurringSchedules = [], isLoading: recurringLoading } = useRecurringSchedules({
    practitioner: practitionerId,
  });

  const { data: blockedTimes = [], isLoading: blockedLoading } = useBlockedTimes({
    practitioner: practitionerId,
    // Fetch blocked times for a slightly wider range to be safe, or just the same range
    start_date: format(calendarStart, 'yyyy-MM-dd'),
    end_date: format(calendarEnd, 'yyyy-MM-dd'),
  });

  const isLoading = slotsLoading || recurringLoading || blockedLoading;

  // Process availability logic
  const { availableDates, unavailableDates, availabilityMap } = useMemo(() => {
    const available = [];
    const unavailable = [];
    const map = {};

    if (isLoading) return { availableDates: [], unavailableDates: [], availabilityMap: {} };

    // Helper to check if a date is blocked
    const isBlocked = (date) => {
      return blockedTimes.some(block => {
        const blockStart = parseISO(block.start_date || block.date);
        const blockEnd = block.end_date ? parseISO(block.end_date) : blockStart;
        return isWithinInterval(date, { start: startOfDay(blockStart), end: startOfDay(blockEnd) });
      });
    };

    // Helper to check if a date matches any recurring schedule
    const isScheduled = (date) => {
      const dayOfWeek = date.getDay(); // 0 = Sunday, 1 = Monday, etc.
      // Adjust for Python/Backend day encoding if necessary (usually 0=Mon, 6=Sun or 0=Sun, 6=Sat)
      // Assuming standard JS getDay() matches backend or we map it.
      // Let's assume backend uses 0=Monday, 6=Sunday based on previous `['Mon', ...][day]` usage.
      // JS getDay(): 0=Sun, 1=Mon, ..., 6=Sat.
      // Mapping JS to Backend (0=Mon...6=Sun):
      const backendDay = dayOfWeek === 0 ? 6 : dayOfWeek - 1;

      return recurringSchedules.some(schedule => {
        if (!schedule.is_active) return false;

        const activeFrom = parseISO(schedule.active_from);
        const activeTo = schedule.active_to ? parseISO(schedule.active_to) : null;

        // Check date range
        if (isBefore(date, startOfDay(activeFrom))) return false;
        if (activeTo && isBefore(startOfDay(activeTo), date)) return false;

        // Check day of week
        return schedule.days_of_week.includes(backendDay);
      });
    };

    // Populate slots map
    const slots = slotsData?.slots || [];
    slots.forEach(slot => {
      const dateStr = format(new Date(slot.start), 'yyyy-MM-dd');
      if (!map[dateStr]) {
        map[dateStr] = [];
      }
      map[dateStr].push(slot);
    });

    // Iterate through each day in the visible grid
    let iterDate = startOfDay(calendarStart);
    const endDate = startOfDay(calendarEnd);

    while (iterDate <= endDate) {
      const isPast = isBefore(iterDate, startOfDay(new Date()));
      const scheduled = isScheduled(iterDate);
      const blocked = isBlocked(iterDate);
      const dateStr = format(iterDate, 'yyyy-MM-dd');
      const hasSlots = !!map[dateStr];

      if (scheduled) {
        if (isPast || blocked) {
          unavailable.push(new Date(iterDate));
        } else if (hasSlots) {
          available.push(new Date(iterDate));
        } else {
          // Scheduled, Future, Not Blocked, but No Slots (e.g. fully booked)
          unavailable.push(new Date(iterDate));
        }
      }

      // Move to next day
      iterDate.setDate(iterDate.getDate() + 1);
    }

    return { availableDates: available, unavailableDates: unavailable, availabilityMap: map };
  }, [slotsData, recurringSchedules, blockedTimes, calendarStart, calendarEnd, isLoading]);


  const isDayAvailable = (day) => {
    return availableDates.some(d => isSameDay(d, day));
  };

  const isDayUnavailable = (day) => {
    return unavailableDates.some(d => isSameDay(d, day));
  };

  const handleSelect = (day) => {
    // Only allow selecting available days (green)
    if (day && isDayAvailable(day)) {
      setSelectedDate(day);
      setSelectedSlotId(null); // Reset selected slot when date changes
    }
  };

  const [selectedSlotId, setSelectedSlotId] = useState(null);

  const handleSlotClick = (slot) => {
    if (slot.status === 'booked') return;
    setSelectedSlotId(slot.id);
    if (onSlotSelect) {
      onSlotSelect(slot);
    }
  };

  const goToPreviousMonth = () => {
    setCurrentMonth(prev => subMonths(prev, 1));
  };

  const goToNextMonth = () => {
    setCurrentMonth(prev => addMonths(prev, 1));
  };

  const selectedDateSlots = selectedDate
    ? (availabilityMap[format(selectedDate, 'yyyy-MM-dd')] || [])
    : [];

  // Sort slots by time
  selectedDateSlots.sort((a, b) => new Date(a.start) - new Date(b.start));

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div className="space-y-4">
        <div className="rounded-md border p-3">
          <div className="flex justify-between items-center mb-4">
            <Button
              variant="outline"
              size="sm"
              onClick={goToPreviousMonth}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="font-semibold">
              {format(currentMonth, 'MMMM yyyy')}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={goToNextMonth}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {isLoading ? (
            <div className="h-[300px] flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={handleSelect}
              month={currentMonth}
              onMonthChange={setCurrentMonth}
              className="w-full flex justify-center"
              modifiers={{
                available: availableDates,
                unavailable: unavailableDates,
              }}
              modifiersClassNames={{
                available: "bg-green-100 text-green-900 font-medium hover:bg-green-200",
                unavailable: "bg-red-50 text-red-900 font-medium opacity-50 hover:bg-red-100 hover:opacity-100",
                selected: "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
              }}
            />
          )}
        </div>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-green-100 border border-green-200"></div>
            <span>Available</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-50 border border-red-200"></div>
            <span>Unavailable</span>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="font-medium text-lg">
          Available Slots for {format(selectedDate, 'MMMM d, yyyy')}
        </h3>

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : selectedDateSlots.length > 0 ? (
          <ScrollArea className="h-[350px] rounded-md border p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {selectedDateSlots.map((slot) => {
                const isBooked = slot.status === 'booked' || slot.status === 'busy'; // Handle 'busy' if used
                const isSelected = selectedSlotId === slot.id;

                return (
                  <Button
                    key={slot.id}
                    variant={isBooked ? "outline" : "default"}
                    className={`justify-start font-normal w-full h-auto py-2 ${isBooked
                        ? "bg-red-50 text-red-900 border-red-200 hover:bg-red-100 hover:text-red-900 opacity-80 cursor-not-allowed"
                        : "bg-green-100 text-green-900 border-green-200 hover:bg-green-200 hover:text-green-900"
                      } ${isSelected ? "ring-2 ring-blue-500 ring-offset-2" : ""}`}
                    onClick={() => handleSlotClick(slot)}
                    disabled={isBooked}
                  >
                    <div className="flex justify-between w-full items-center">
                      <span>{format(new Date(slot.start), 'h:mm a')} - {format(new Date(slot.end), 'h:mm a')}</span>
                      {isBooked && <span className="text-xs font-semibold ml-2">(Booked)</span>}
                    </div>
                  </Button>
                );
              })}
            </div>
          </ScrollArea>
        ) : (
          <div className="flex flex-col items-center justify-center h-[200px] border rounded-md bg-muted/10 text-muted-foreground">
            <p>No slots available for this date.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default DoctorAvailabilityCalendar;
