import { AvailabilityCalendarPanel } from './AvailabilityCalendarPanel';
import { AvailabilitySlotsPanel } from './AvailabilitySlotsPanel';
import { useDoctorAvailabilityCalendarController } from './useDoctorAvailabilityCalendarController';

/**
 * DoctorAvailabilityCalendar - Chronicle-style calendar component.
 */
export default function DoctorAvailabilityCalendar({
  clinicId,
  practitionerId,
  serviceId,
  onSlotSelect,
}) {
  const controller = useDoctorAvailabilityCalendarController({
    clinicId,
    onSlotSelect,
    practitionerId,
    serviceId,
  });

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      <AvailabilityCalendarPanel
        availableDates={controller.availableDates}
        currentMonth={controller.currentMonth}
        goToNextMonth={controller.goToNextMonth}
        goToPreviousMonth={controller.goToPreviousMonth}
        handleSelect={controller.handleSelect}
        isLoading={controller.isLoading}
        selectedDate={controller.selectedDate}
        setCurrentMonth={controller.setCurrentMonth}
        unavailableDates={controller.unavailableDates}
      />

      <AvailabilitySlotsPanel
        capacitySummary={controller.capacitySummary}
        handleSlotClick={controller.handleSlotClick}
        isLoading={controller.isLoading}
        selectedDate={controller.selectedDate}
        selectedDateSlots={controller.selectedDateSlots}
        selectedSlotId={controller.selectedSlotId}
      />
    </div>
  );
}
