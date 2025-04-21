import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * TimeSlotsGrid component
 * Displays available time slots in a responsive grid
 * 
 * @param {Object} props - Component props
 * @param {Array} props.slots - Array of time slot objects
 * @param {string} props.selectedSlotId - ID of the currently selected slot
 * @param {Function} props.onSlotSelect - Callback when a slot is selected
 * @param {boolean} props.isLoading - Whether slots are loading
 * @param {string} props.emptyMessage - Message to display when no slots are available
 */
const TimeSlotsGrid = ({
  slots = [],
  selectedSlotId = null,
  onSlotSelect,
  isLoading = false,
  emptyMessage = "No available time slots for the selected date."
}) => {
  // State for tracking which slots have been seen for analytics (optional)
  const [viewedSlots, setViewedSlots] = useState(new Set());

  // Mark slots as viewed when they come into view (for analytics)
  const handleSlotInView = (slotId) => {
    if (!viewedSlots.has(slotId)) {
      setViewedSlots(new Set([...viewedSlots, slotId]));
    }
  };

  // Format time from ISO string
  const formatTime = (isoString) => {
    try {
      return format(parseISO(isoString), 'h:mm a');
    } catch (error) {
      console.error('Error formatting time:', error);
      return 'Invalid time';
    }
  };

  // Calculate duration in minutes between start and end times
  const calculateDuration = (startTime, endTime) => {
    try {
      const start = parseISO(startTime);
      const end = parseISO(endTime);
      return Math.round((end - start) / (1000 * 60)); // Duration in minutes
    } catch (error) {
      console.error('Error calculating duration:', error);
      return 0;
    }
  };

  // Render loading skeleton
  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-16 w-full rounded-md" />
          ))}
        </div>
      </div>
    );
  }

  // Render empty state
  if (!isLoading && (!slots || slots.length === 0)) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <Clock className="h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[300px] pr-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {slots.map((slot) => {
          const startTime = formatTime(slot.start);
          const endTime = formatTime(slot.end);
          const duration = calculateDuration(slot.start, slot.end);
          const isSelected = selectedSlotId === slot.id;
          // All slots should be available since we're filtering by status in the API call,
          // but we'll check just to be safe
          const isAvailable = slot.status === 'free' || !slot.status;

          return (
            <Button
              type="button"
              key={slot.id}
              variant="outline"
              className={cn(
                "h-auto py-3 px-4 justify-start text-left relative",
                isSelected && "border-2 border-blue-500",
                isAvailable ? "bg-green-100 hover:bg-green-200" : "bg-red-100 hover:bg-red-200",
                !isAvailable && "opacity-60 cursor-not-allowed"
              )}
              disabled={!isAvailable}
              onClick={() => isAvailable && onSlotSelect(slot)}
              onFocus={() => handleSlotInView(slot.id)}
              aria-label={`${startTime} to ${endTime}, ${duration} minutes, ${isAvailable ? 'available' : 'unavailable'}`}
            >
              <div className="flex flex-col space-y-1 w-full">
                <div className="flex justify-between items-center">
                  <span className="font-medium">{startTime}</span>
                  <Badge 
                    variant="outline" 
                    className={cn(
                      "ml-2",
                      isAvailable ? "bg-green-100 text-green-800 border-green-200" : "bg-red-100 text-red-800 border-red-200"
                    )}
                  >
                    {isAvailable ? "Available" : "Unavailable"}
                  </Badge>
                </div>
                <div className="flex items-center text-sm text-muted-foreground">
                  <Clock className="h-3 w-3 mr-1" />
                  <span>{duration} min</span>
                  <span className="mx-1">•</span>
                  <span>Until {endTime}</span>
                </div>
              </div>
            </Button>
          );
        })}
      </div>
    </ScrollArea>
  );
};

export default TimeSlotsGrid;
