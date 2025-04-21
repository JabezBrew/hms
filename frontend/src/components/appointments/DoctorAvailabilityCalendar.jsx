import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * DoctorAvailabilityCalendar component (Simplified Presentational Component)
 * Displays a calendar with color-coded days based on provided availability data.
 *
 * @param {Object} props - Component props
 * @param {Date} props.currentMonth - The month the calendar should display
 * @param {Function} props.onMonthChange - Callback when the month changes
 * @param {Date | null} props.selectedDate - The currently selected date
 * @param {Function} props.onDateChange - Callback when a date is selected
 * @param {Object} props.availabilityData - Map of dates {'YYYY-MM-DD': { hasSlots: boolean }}
 * @param {boolean} props.isLoading - Whether the calendar data is loading
 */
const DoctorAvailabilityCalendar = ({
  currentMonth,
  onMonthChange,
  selectedDate,
  onDateChange,
  availabilityData = {}, // Default to empty object
  isLoading = false,
}) => {

  // Determine available days based on the provided availabilityData
  const availableModifiers = Object.entries(availabilityData)
    .filter(([, data]) => data.hasSlots)
    .map(([dateStr]) => new Date(dateStr + 'T00:00:00')); // Ensure correct date parsing

  // Function to check if a day has available slots based on props
  const isDayAvailable = (day) => {
    const formattedDay = format(day, 'yyyy-MM-dd');
    return !!availabilityData[formattedDay]?.hasSlots;
  };

  // Handle date selection: only call onDateChange if the day is available
  const handleSelect = (day) => {
    if (day && isDayAvailable(day)) {
      onDateChange(day);
    }
    // If an unavailable day is clicked, potentially deselect or do nothing
    // Current implementation: clicking unavailable day does nothing selection-wise
  };

  // Function to navigate to previous month
  const goToPreviousMonth = () => {
    onMonthChange(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };

  // Function to navigate to next month
  const goToNextMonth = () => {
    onMonthChange(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };

  if (isLoading) {
    return (
       <div className="space-y-4">
         <Skeleton className="h-[290px] w-full rounded-md" />
         <div className="flex justify-between">
            <Skeleton className="h-9 w-36" />
            <Skeleton className="h-9 w-36" />
         </div>
       </div>
    );
  }

  return (
    <div className="space-y-4">
      <Calendar
        mode="single"
        selected={selectedDate}
        onSelect={handleSelect}
        month={currentMonth} // Control the displayed month
        onMonthChange={onMonthChange} // Let parent handle month state
        className="rounded-md border"
        modifiers={{
          available: availableModifiers,
          today: [new Date()], // Keep today highlighted
          // selected: selectedDate ? [selectedDate] : [], // Already handled by `selected` prop
        }}
        modifiersClassNames={{
          available: "bg-green-200 text-green-900 hover:bg-green-400 enabled:hover:text-green-900",
          today: "bg-blue-50 text-blue-900 font-bold",
          selected: "border-2 border-blue-500 text-foreground hover:border-blue-600",
        }}
        // Disable days that are not marked as available in the data
        disabled={(day) => !isDayAvailable(day)}
        // Ensure already selected available days are clickable for potential deselection logic later
        // onDayClick logic now handled by onSelect + disabled check
      />
       <div className="flex justify-between">
          <Button
            variant="outline"
            size="sm"
            onClick={goToPreviousMonth}
          >
            <ChevronLeft className="h-4 w-4 mr-2" />
            Previous Month
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={goToNextMonth}
          >
            Next Month
            <ChevronRight className="h-4 w-4 ml-2" />
          </Button>
        </div>
    </div>
  );
};

export default DoctorAvailabilityCalendar;
