import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import CalendarCheck from 'lucide-react/dist/esm/icons/calendar-check.js';
import CalendarX from 'lucide-react/dist/esm/icons/calendar-x.js';
import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import format from 'date-fns/format';
import startOfMonth from 'date-fns/startOfMonth';
import endOfMonth from 'date-fns/endOfMonth';
import addMonths from 'date-fns/addMonths';
import subMonths from 'date-fns/subMonths';
import startOfWeek from 'date-fns/startOfWeek';
import endOfWeek from 'date-fns/endOfWeek';
import isBefore from 'date-fns/isBefore';
import startOfDay from 'date-fns/startOfDay';
import isSameDay from 'date-fns/isSameDay';
import parseISO from 'date-fns/parseISO';
import isWithinInterval from 'date-fns/isWithinInterval';

import {
  useAvailableSlots,
  useBlockedTimes
} from '@/features/appointments/hooks/useAppointmentQueries';

/**
 * DoctorAvailabilityCalendar - Chronicle-style calendar component
 *
 * Features:
 * - Visual calendar with availability indicators
 * - Slot selection for selected date
 * - Two-column layout (calendar | slots)
 */
const DoctorAvailabilityCalendar = ({
  clinicId,
  practitionerId,
  serviceId,
  onSlotSelect,
}) => {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedSlotId, setSelectedSlotId] = useState(null);

  // Calculate visible date range
  const calendarStart = startOfWeek(startOfMonth(currentMonth));
  const calendarEnd = endOfWeek(endOfMonth(currentMonth));

  const hasPractitioner = Boolean(practitionerId);
  const hasClinic = Boolean(clinicId);

  const dateRangeParams = useMemo(() => {
    const params = {
      start_date: format(calendarStart, 'yyyy-MM-dd'),
      end_date: format(calendarEnd, 'yyyy-MM-dd'),
    };

    if (hasPractitioner) {
      params.practitioner_id = practitionerId;
      if (hasClinic) {
        params.clinic_id = clinicId;
      }
    } else if (hasClinic) {
      params.clinic_id = clinicId;
    }
    if (serviceId) {
      params.service_id = serviceId;
    }

    return params;
  }, [calendarEnd, calendarStart, clinicId, hasClinic, hasPractitioner, practitionerId, serviceId]);

  // Fetch slots with server-side filtering by practitioner or clinic
  const { data: slotsData, isLoading: slotsLoading } = useAvailableSlots(dateRangeParams, {
    enabled: hasPractitioner || hasClinic,
  });

  const { data: blockedTimesData, isLoading: blockedLoading } = useBlockedTimes(
    practitionerId ? { practitioner: practitionerId } : {},
    { enabled: hasPractitioner }
  );

  const blockedTimes = useMemo(
    () => (Array.isArray(blockedTimesData)
      ? blockedTimesData
      : blockedTimesData?.results || []),
    [blockedTimesData]
  );

  const isLoading = slotsLoading || blockedLoading;

  // Process availability
  const { availableDates, unavailableDates, availabilityMap } = useMemo(() => {
    const available = [];
    const unavailable = [];
    const map = {};

    if (isLoading) return { availableDates: [], unavailableDates: [], availabilityMap: {} };

    const isBlocked = (date) => {
      return blockedTimes.some(block => {
        const blockStart = parseISO(block.start_date || block.date);
        const blockEnd = block.end_date ? parseISO(block.end_date) : blockStart;
        return isWithinInterval(date, { start: startOfDay(blockStart), end: startOfDay(blockEnd) });
      });
    };

    // Get slots from API response
    const slots = slotsData?.slots || (Array.isArray(slotsData) ? slotsData : []);

    // Populate slots map
    slots.forEach(slot => {
      const dateStr = format(new Date(slot.start), 'yyyy-MM-dd');
      if (!map[dateStr]) {
        map[dateStr] = [];
      }
      map[dateStr].push(slot);
    });

    // Iterate through visible days
    let iterDate = startOfDay(calendarStart);
    const endDate = startOfDay(calendarEnd);

    while (iterDate <= endDate) {
      const isPast = isBefore(iterDate, startOfDay(new Date()));
      const blocked = isBlocked(iterDate);
      const dateStr = format(iterDate, 'yyyy-MM-dd');
      const hasSlots = map[dateStr]?.some(s => s.status === 'free' || !s.status);

      if (!isPast && !blocked && hasSlots) {
        available.push(new Date(iterDate));
      } else if (hasSlots || blocked) {
        unavailable.push(new Date(iterDate));
      }

      iterDate = new Date(iterDate);
      iterDate.setDate(iterDate.getDate() + 1);
    }

    return { availableDates: available, unavailableDates: unavailable, availabilityMap: map };
  }, [slotsData, blockedTimes, calendarStart, calendarEnd, isLoading]);

  const isDayAvailable = (day) => availableDates.some(d => isSameDay(d, day));

  const handleSelect = (day) => {
    if (day && isDayAvailable(day)) {
      setSelectedDate(day);
      setSelectedSlotId(null);
    }
  };

  const handleSlotClick = (slot) => {
    const cap = slot.capacity || null;
    const remaining =
      cap && cap.remaining !== undefined && cap.remaining !== null
        ? Number(cap.remaining)
        : (slot.status === 'booked' || slot.status === 'busy' ? 0 : 1);
    if (!Number.isFinite(remaining) ? true : remaining <= 0) return;
    if (slot.status === 'busy-unavailable') return;
    setSelectedSlotId(slot.id);
    if (onSlotSelect) {
      onSlotSelect(slot);
    }
  };

  const selectedDateSlots = useMemo(() => {
    if (!selectedDate) {
      return [];
    }
    return [...(availabilityMap[format(selectedDate, 'yyyy-MM-dd')] || [])]
      .sort((a, b) => new Date(a.start) - new Date(b.start));
  }, [availabilityMap, selectedDate]);

  const capacitySummary = useMemo(() => {
    let totalMax = 0;
    let totalRemaining = 0;
    selectedDateSlots.forEach((slot) => {
      const cap = slot.capacity || null;
      const max =
        cap && cap.max !== undefined && cap.max !== null ? Number(cap.max) : 1;
      const remaining =
        cap && cap.remaining !== undefined && cap.remaining !== null
          ? Number(cap.remaining)
          : (slot.status === 'booked' || slot.status === 'busy' ? 0 : 1);
      if (Number.isFinite(max)) totalMax += Math.max(0, max);
      if (Number.isFinite(remaining)) totalRemaining += Math.max(0, remaining);
    });
    return {
      totalMax,
      totalRemaining,
      totalBooked: Math.max(0, totalMax - totalRemaining),
    };
  }, [selectedDateSlots]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Calendar */}
      <div className="space-y-4">
        <div className="rounded-xl border border-border/50 p-4">
          {/* Month Navigation */}
          <div className="flex justify-between items-center mb-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCurrentMonth(prev => subMonths(prev, 1))}
              className="h-8 w-8 p-0"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <h3 className="font-semibold text-foreground">
              {format(currentMonth, 'MMMM yyyy')}
            </h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCurrentMonth(prev => addMonths(prev, 1))}
              className="h-8 w-8 p-0"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {/* Calendar Grid */}
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
                available: "bg-emerald-500/20 text-emerald-700 font-medium hover:bg-emerald-500/30 dark:text-emerald-400",
                unavailable: "bg-rose-500/10 text-rose-700/50 font-medium cursor-not-allowed dark:text-rose-400/50",
                selected: "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground",
              }}
            />
          )}
        </div>

        {/* Legend */}
        <div className="flex items-center justify-center gap-6 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-emerald-500/30 border border-emerald-500/50" />
            <span className="text-muted-foreground">Available</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-rose-500/20 border border-rose-500/30" />
            <span className="text-muted-foreground">Unavailable</span>
          </div>
        </div>
      </div>

      {/* Slots Panel */}
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-foreground">
              {format(selectedDate, 'EEEE, MMMM d')}
            </h3>
            <p className="text-sm text-muted-foreground">
              {selectedDateSlots.length > 0
                ? `${capacitySummary.totalRemaining} remaining, ${capacitySummary.totalBooked} booked`
                : 'No scheduled slots'
              }
            </p>
          </div>
          {selectedDateSlots.length > 0 && (
            <div className="flex gap-2">
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30">
                <CalendarCheck className="h-3 w-3 mr-1" />
                {capacitySummary.totalRemaining}
              </Badge>
              <Badge variant="outline" className="bg-rose-500/10 text-rose-600 border-rose-500/30">
                <CalendarX className="h-3 w-3 mr-1" />
                {capacitySummary.totalBooked}
              </Badge>
            </div>
          )}
        </div>

        {/* Slots List */}
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : selectedDateSlots.length > 0 ? (
          <ScrollArea className="h-[350px] rounded-xl border border-border/50 p-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {selectedDateSlots.map((slot) => {
                const cap = slot.capacity || null;
                const remaining =
                  cap && cap.remaining !== undefined && cap.remaining !== null
                    ? Number(cap.remaining)
                    : (slot.status === 'booked' || slot.status === 'busy' ? 0 : 1);
                const max =
                  cap && cap.max !== undefined && cap.max !== null ? Number(cap.max) : 1;
                const isBooked = slot.status === 'booked' || slot.status === 'busy' || remaining <= 0;
                const isSelected = selectedSlotId === slot.id;

                return (
                  <button
                    key={slot.id}
                    type="button"
                    onClick={() => handleSlotClick(slot)}
                    disabled={isBooked}
                    className={cn(
                      "flex items-center justify-between p-3 rounded-lg border transition-all text-left",
                      isBooked
                        ? "bg-rose-500/5 border-rose-500/20 text-rose-600/60 cursor-not-allowed"
                        : "bg-emerald-500/5 border-emerald-500/20 text-emerald-700 hover:bg-emerald-500/10 hover:border-emerald-500/40 cursor-pointer dark:text-emerald-400",
                      isSelected && !isBooked && "ring-2 ring-primary ring-offset-2"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Clock className={cn(
                        "h-4 w-4",
                        isBooked ? "text-rose-400" : "text-emerald-500"
                      )} />
                      <span className="font-mono text-sm">
                        {format(new Date(slot.start), 'h:mm a')} - {format(new Date(slot.end), 'h:mm a')}
                      </span>
                    </div>
                    {Number.isFinite(max) && max > 1 ? (
                      <Badge
                        variant="secondary"
                        className={cn(
                          "text-[10px] px-1.5 py-0",
                          remaining > 0
                            ? "bg-emerald-500/10 text-emerald-700"
                            : "bg-rose-500/10 text-rose-600"
                        )}
                      >
                        {remaining > 0 ? `${remaining}/${max} left` : 'Full'}
                      </Badge>
                    ) : isBooked ? (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-rose-500/10 text-rose-600">
                        Booked
                      </Badge>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        ) : (
          <div className="flex flex-col items-center justify-center h-[200px] rounded-xl border border-border/50 bg-muted/20">
            <Clock className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-muted-foreground text-sm">No slots for this date</p>
            <p className="text-muted-foreground/60 text-xs mt-1">
              Select an available day on the calendar
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default DoctorAvailabilityCalendar;
