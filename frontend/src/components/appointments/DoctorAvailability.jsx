import { useState, useEffect, useCallback } from 'react';
import { format, addDays, startOfDay, endOfDay, startOfMonth, endOfMonth } from 'date-fns';
import { toast } from 'sonner';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchAvailableSlots } from '@/lib/api.js';
import { useDebounce } from '@/hooks/use-debounce';

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
  const [currentMonth, setCurrentMonth] = useState(startOfMonth(new Date())); // Track displayed month
  const [selectedDate, setSelectedDate] = useState(null); // Default to null, select on click
  const [availabilityData, setAvailabilityData] = useState({}); // Availability summary for calendar
  const [slots, setSlots] = useState([]); // Slots for the selected date
  const [isLoadingCalendar, setIsLoadingCalendar] = useState(false);
  const [isLoadingSlots, setIsLoadingSlots] = useState(false);
  const [error, setError] = useState(null);

  // Debounce practitioner and appointment type changes
  const debouncedPractitionerId = useDebounce(practitionerId, 300);
  const debouncedAppointmentTypeId = useDebounce(appointmentTypeId, 300);

  // Fetch availability data for the calendar (for the currently viewed month +/- buffer)
  const fetchAvailabilityData = useCallback(async (monthToFetch) => {
    if (!debouncedPractitionerId) {
       setAvailabilityData({}); // Clear data if no practitioner
       return;
    }

    setIsLoadingCalendar(true);
    setError(null); // Clear previous errors

    try {
      // Fetch for the month +/- some buffer days for calendar view continuity
      const firstDay = startOfMonth(monthToFetch);
      const lastDay = endOfMonth(monthToFetch);
      const startDate = format(addDays(firstDay, -7), 'yyyy-MM-dd');
      const endDate = format(addDays(lastDay, 7), 'yyyy-MM-dd');

      const params = new URLSearchParams({
        practitioner_id: debouncedPractitionerId,
        start_date: startDate,
        end_date: endDate,
        status: 'free', // Only need to know if *any* slot is available for the day
      });

      if (debouncedAppointmentTypeId) {
        params.append('appointment_type_id', debouncedAppointmentTypeId);
      }

      const slotsData = await fetchAvailableSlots(params);

      // Process slots data to create availability map by date
      const availabilityMap = {};
      if (Array.isArray(slotsData)) {
        slotsData.forEach(slot => {
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
      // Merge with existing data if needed, or replace entirely for the new month view
      // For simplicity, let's replace entirely when the month changes
      setAvailabilityData(availabilityMap);

    } catch (error) {
      console.error('Error fetching availability data:', error);
      setError('Failed to load availability data. Please try again.');
      toast.error('Failed to load availability data');
      setAvailabilityData({}); // Clear data on error
    } finally {
      setIsLoadingCalendar(false);
    }
  }, [debouncedPractitionerId, debouncedAppointmentTypeId]);

  // Fetch slots for the specifically selected date
  const fetchSlotsForDate = useCallback(async (dateToFetch) => {
    // No need to fetch if no date is selected
    if (!debouncedPractitionerId || !dateToFetch) {
       setSlots([]); // Clear slots if no date/practitioner
       return;
    }

    setIsLoadingSlots(true);
    setError(null); // Clear previous errors

    try {
      const formattedDate = format(dateToFetch, 'yyyy-MM-dd');
      const params = new URLSearchParams({
        practitioner_id: debouncedPractitionerId,
        start_date: formattedDate,
        end_date: formattedDate,
        status: 'free', // Only fetch available slots
      });

      if (debouncedAppointmentTypeId) {
        params.append('appointment_type_id', debouncedAppointmentTypeId);
      }

      const slotsData = await fetchAvailableSlots(params);
      setSlots(Array.isArray(slotsData) ? slotsData : []);
    } catch (error) {
      console.error('Error fetching slots for date:', error);
      setError('Failed to load time slots. Please try again.');
      toast.error('Failed to load time slots');
      setSlots([]); // Clear slots on error
    } finally {
      setIsLoadingSlots(false);
    }
  }, [debouncedPractitionerId, debouncedAppointmentTypeId]);

  // Effect for fetching calendar availability when practitioner, appt type, or month changes
  useEffect(() => {
    fetchAvailabilityData(currentMonth);
  }, [debouncedPractitionerId, debouncedAppointmentTypeId, currentMonth, fetchAvailabilityData]);

  // Effect for fetching slots when the selected date changes
  useEffect(() => {
    // Trigger fetch only if selectedDate is not null
    if (selectedDate) {
        fetchSlotsForDate(selectedDate);
    } else {
        setSlots([]); // Clear slots if date is deselected
    }
  }, [selectedDate, fetchSlotsForDate]); // Depends only on selectedDate and the fetch function itself

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
    setSlots([]); // Clear slots when changing month
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

  // Main render logic
  return (
    <Card>
      <CardHeader>
        <CardTitle>Doctor Availability</CardTitle>
        {error && (
          <div className="bg-destructive/10 text-destructive p-3 rounded-md text-sm mt-2">
            {error}
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
               slots={slots}
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