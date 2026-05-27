import { useMemo, useState } from 'react';
import format from 'date-fns/format';
import addMonths from 'date-fns/addMonths';
import subMonths from 'date-fns/subMonths';
import startOfMonth from 'date-fns/startOfMonth';
import endOfMonth from 'date-fns/endOfMonth';
import startOfWeek from 'date-fns/startOfWeek';
import endOfWeek from 'date-fns/endOfWeek';
import isSameDay from 'date-fns/isSameDay';

import {
  useAvailableSlots,
  useBlockedTimes,
} from '@/features/appointments/hooks/useAppointmentQueries';

import {
  buildAvailabilityState,
  slotAvailability,
  summarizeSlotCapacity,
} from './availabilityUtils';

export function useDoctorAvailabilityCalendarController({
  clinicId,
  onSlotSelect,
  practitionerId,
  serviceId,
}) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [selectedSlotId, setSelectedSlotId] = useState(null);
  const hasPractitioner = Boolean(practitionerId);
  const hasClinic = Boolean(clinicId);
  const { calendarStart, calendarEnd } = useMemo(() => ({
    calendarStart: startOfWeek(startOfMonth(currentMonth)),
    calendarEnd: endOfWeek(endOfMonth(currentMonth)),
  }), [currentMonth]);
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
  const { availableDates, unavailableDates, availabilityMap } = useMemo(
    () => buildAvailabilityState({
      blockedTimes,
      calendarEnd,
      calendarStart,
      isLoading,
      slotsData,
    }),
    [blockedTimes, calendarEnd, calendarStart, isLoading, slotsData]
  );
  const selectedDateSlots = useMemo(() => {
    if (!selectedDate) {
      return [];
    }
    return (availabilityMap[format(selectedDate, 'yyyy-MM-dd')] || [])
      .toSorted((first, second) => new Date(first.start) - new Date(second.start));
  }, [availabilityMap, selectedDate]);
  const capacitySummary = useMemo(
    () => summarizeSlotCapacity(selectedDateSlots),
    [selectedDateSlots]
  );
  const isDayAvailable = (day) => availableDates.some((availableDate) =>
    isSameDay(availableDate, day)
  );
  const handleSelect = (day) => {
    if (day && isDayAvailable(day)) {
      setSelectedDate(day);
      setSelectedSlotId(null);
    }
  };
  const handleSlotClick = (slot) => {
    if (!slotAvailability(slot).selectable) return;
    setSelectedSlotId(slot.id);
    if (onSlotSelect) {
      onSlotSelect(slot);
    }
  };
  const goToPreviousMonth = () => setCurrentMonth((previousMonth) =>
    subMonths(previousMonth, 1)
  );
  const goToNextMonth = () => setCurrentMonth((previousMonth) =>
    addMonths(previousMonth, 1)
  );

  return {
    availableDates,
    capacitySummary,
    currentMonth,
    goToNextMonth,
    goToPreviousMonth,
    handleSelect,
    handleSlotClick,
    isLoading,
    selectedDate,
    selectedDateSlots,
    selectedSlotId,
    setCurrentMonth,
    unavailableDates,
  };
}
