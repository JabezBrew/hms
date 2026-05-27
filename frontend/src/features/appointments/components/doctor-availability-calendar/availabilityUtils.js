import format from 'date-fns/format';
import isBefore from 'date-fns/isBefore';
import isWithinInterval from 'date-fns/isWithinInterval';
import parseISO from 'date-fns/parseISO';
import startOfDay from 'date-fns/startOfDay';

function numberOr(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function slotAvailability(slot) {
  const capacity = slot?.capacity || null;
  const remaining = capacity
    ? numberOr(capacity.remaining, 0)
    : (slot?.status === 'booked' || slot?.status === 'busy' ? 0 : 1);
  const overbookRemaining = capacity ? numberOr(capacity.overbook_remaining, 0) : 0;
  const max = capacity ? numberOr(capacity.max, 1) : 1;
  const unavailable = slot?.status === 'busy-unavailable' || slot?.status === 'cancelled';
  const overbook = slot?.status === 'overbook_available' || (remaining <= 0 && overbookRemaining > 0);
  const selectable = !unavailable && (remaining > 0 || overbookRemaining > 0);

  return {
    max,
    remaining,
    overbookRemaining,
    overbook,
    selectable,
  };
}

function isDateBlocked(date, blockedTimes) {
  return blockedTimes.some((block) => {
    const blockStart = parseISO(block.start_date || block.date);
    const blockEnd = block.end_date ? parseISO(block.end_date) : blockStart;
    return isWithinInterval(date, {
      start: startOfDay(blockStart),
      end: startOfDay(blockEnd),
    });
  });
}

export function buildAvailabilityState({
  blockedTimes,
  calendarEnd,
  calendarStart,
  isLoading,
  slotsData,
}) {
  const available = [];
  const unavailable = [];
  const map = {};

  if (isLoading) {
    return { availableDates: [], unavailableDates: [], availabilityMap: {} };
  }

  const slots = slotsData?.slots || (Array.isArray(slotsData) ? slotsData : []);

  for (const slot of slots) {
    const dateStr = format(new Date(slot.start), 'yyyy-MM-dd');
    if (!map[dateStr]) {
      map[dateStr] = [];
    }
    map[dateStr].push(slot);
  }

  let iterDate = startOfDay(calendarStart);
  const endDate = startOfDay(calendarEnd);
  const today = startOfDay(new Date());

  while (iterDate <= endDate) {
    const isPast = isBefore(iterDate, today);
    const blocked = isDateBlocked(iterDate, blockedTimes);
    const dateStr = format(iterDate, 'yyyy-MM-dd');
    const hasSlots = map[dateStr]?.some((slot) => slotAvailability(slot).selectable);

    if (!isPast && !blocked && hasSlots) {
      available.push(new Date(iterDate));
    } else if (hasSlots || blocked) {
      unavailable.push(new Date(iterDate));
    }

    iterDate = new Date(iterDate);
    iterDate.setDate(iterDate.getDate() + 1);
  }

  return { availableDates: available, unavailableDates: unavailable, availabilityMap: map };
}

export function summarizeSlotCapacity(slots) {
  let totalMax = 0;
  let totalRemaining = 0;
  let totalOverbookRemaining = 0;

  for (const slot of slots) {
    const availability = slotAvailability(slot);
    totalMax += Math.max(0, availability.max);
    totalRemaining += Math.max(0, availability.remaining);
    totalOverbookRemaining += Math.max(0, availability.overbookRemaining);
  }

  return {
    totalMax,
    totalRemaining,
    totalOverbookRemaining,
    totalBooked: Math.max(0, totalMax - totalRemaining),
  };
}
