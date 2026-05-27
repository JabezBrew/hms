import { useMemo, useState } from 'react';
import format from 'date-fns/format';
import addDays from 'date-fns/addDays';
import startOfDay from 'date-fns/startOfDay';
import startOfMonth from 'date-fns/startOfMonth';
import endOfMonth from 'date-fns/endOfMonth';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useDebounce } from '@/hooks/use-debounce';
import { useAvailableSlots } from '@/features/appointments/hooks/useAppointmentQueries';

import DoctorAvailabilityCalendarView from './DoctorAvailabilityCalendar';
import TimeSlotsGrid from './TimeSlotsGrid';

/**
 * DoctorAvailability component (Consolidated)
 * Fetches and displays doctor availability calendar and time slots.
 *
 * @param {Object} props - Component props
 * @param {string} props.practitionerId - ID of the selected practitioner
 * @param {string} props.appointmentTypeId - ID of the selected appointment type
 * @param {Function} props.onSlotSelect - Callback when a slot is selected
 * @param {string | null} props.selectedSlotId - ID of the currently selected slot
 */
const DoctorAvailability = ({
  practitionerId,
  appointmentTypeId,
  onSlotSelect,
  selectedSlotId = null,
}) => {
  // State
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date())); // Track displayed month
  const [selectedDate, setSelectedDate] = useState(null); // Default to null, select on click

  // Debounce practitioner and appointment type changes
  const debouncedPractitionerId = useDebounce(practitionerId, 300);
  const debouncedAppointmentTypeId = useDebounce(appointmentTypeId, 300);

  // Prepare params for calendar view (month +/- buffer)
  const calendarParams = useMemo(() => {
    if (!debouncedPractitionerId) return null;

    const firstDay = startOfMonth(currentMonth);
    const lastDay = endOfMonth(currentMonth);
    const startDate = format(addDays(firstDay, -7), 'yyyy-MM-dd');
    const endDate = format(addDays(lastDay, 7), 'yyyy-MM-dd');

    const params = {
      practitioner_id: debouncedPractitionerId,
      start_date: startDate,
      end_date: endDate,
      status: 'free'
    };

    if (debouncedAppointmentTypeId) {
      params.appointment_type_id = debouncedAppointmentTypeId;
    }

    return params;
  }, [currentMonth, debouncedAppointmentTypeId, debouncedPractitionerId]);

  // Prepare params for selected date
  const dateParams = useMemo(() => {
    if (!debouncedPractitionerId || !selectedDate) return null;

    const formattedDate = format(selectedDate, 'yyyy-MM-dd');

    const params = {
      practitioner_id: debouncedPractitionerId,
      start_date: formattedDate,
      end_date: formattedDate,
      status: 'free'
    };

    if (debouncedAppointmentTypeId) {
      params.appointment_type_id = debouncedAppointmentTypeId;
    }

    return params;
  }, [debouncedAppointmentTypeId, debouncedPractitionerId, selectedDate]);

  // Use React Query to fetch calendar data
  const {
    data: calendarData,
    isLoading: isLoadingCalendar,
    error: calendarError
  } = useAvailableSlots(calendarParams || {}, {
    enabled: !!calendarParams
  });

  // Use React Query to fetch slots for selected date
  const {
    data: slotsData,
    isLoading: isLoadingSlots,
    error: slotsError
  } = useAvailableSlots(dateParams || {}, {
    enabled: !!dateParams
  });

  // Process calendar data to create availability map
  const availabilityData = useMemo(() => {
    const availabilityMap = {};

    if (Array.isArray(calendarData)) {
      calendarData.forEach(slot => {
        // Use startOfDay to ensure consistency regardless of slot time
        const slotDateStr = format(startOfDay(new Date(slot.start)), 'yyyy-MM-dd');
        if (!availabilityMap[slotDateStr]) {
          availabilityMap[slotDateStr] = { hasSlots: false };
        }
        if (slot.status === 'free') { // Double check status if API might return others
          availabilityMap[slotDateStr].hasSlots = true;
        }
      });
    }

    return availabilityMap;
  }, [calendarData]);

  // Handler for date selection from the calendar component
  const handleDateChange = (date) => {
    // If the same date is clicked again, deselect it (optional behavior)
    // if (selectedDate && isSameDay(date, selectedDate)) {
    //   setSelectedDate(null);
    // } else {
       setSelectedDate(date); // Update the selected date
    // }
  };

  // Handler for month change from the calendar component
  const handleMonthChange = (newMonth) => {
    setCurrentMonth(startOfMonth(newMonth)); // Ensure it's the start of the month
    setSelectedDate(null); // Deselect date when changing month
  };

  // Handler for slot selection (passed to TimeSlotsGrid)
  const handleSlotSelect = (slot) => {
    if (onSlotSelect) {
      onSlotSelect(slot);
    }
  };

  // Render initial state if no practitioner is selected
  if (!practitionerId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Doctor Availability</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Please select a doctor to view their availability.</p>
        </CardContent>
      </Card>
    );
  }

  // Determine if there's an error to display
  const error = calendarError || slotsError;

  // Main render logic
  return (
    <Card>
      <CardHeader>
        <CardTitle>Doctor Availability</CardTitle>
        {error && (
          <div className="bg-destructive/10 text-destructive p-3 rounded-md text-sm mt-2">
            {error.message || 'An error occurred while loading availability data.'}
          </div>
        )}
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Simplified Calendar View Component */}
        <DoctorAvailabilityCalendarView
          currentMonth={currentMonth}
          onMonthChange={handleMonthChange}
          selectedDate={selectedDate}
          onDateChange={handleDateChange}
          availabilityData={availabilityData}
          isLoading={isLoadingCalendar}
        />

        {/* Time slots grid - Render only if a date is selected */}
        {selectedDate && (
           <div className="space-y-2 pt-4 border-t">
             <h3 className="text-sm font-medium">
                Available Time Slots for {format(selectedDate, 'EEEE, MMMM d, yyyy')}
             </h3>
             <TimeSlotsGrid
               slots={Array.isArray(slotsData) ? slotsData : []}
               selectedSlotId={selectedSlotId}
               onSlotSelect={handleSlotSelect}
               isLoading={isLoadingSlots}
               emptyMessage={
                 isLoadingCalendar || isLoadingSlots // Show loading if either calendar or slots are loading
                   ? "Loading availability..."
                   : "No available time slots for the selected date."
               }
             />
           </div>
        )}
      </CardContent>
    </Card>
  );
};

export default DoctorAvailability;
