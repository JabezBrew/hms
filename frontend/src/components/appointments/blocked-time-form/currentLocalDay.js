import { useSyncExternalStore } from 'react';

const startOfLocalDay = (date = new Date()) => {
  const nextDate = new Date(date);
  nextDate.setHours(0, 0, 0, 0);
  return nextDate;
};

export const copyDate = (date) => new Date(date.getTime());

let currentDayStartSnapshot = startOfLocalDay();

const getCurrentDayStartSnapshot = () => {
  const nextDayStart = startOfLocalDay();
  if (nextDayStart.getTime() !== currentDayStartSnapshot.getTime()) {
    currentDayStartSnapshot = nextDayStart;
  }
  return currentDayStartSnapshot;
};

const subscribeToCurrentDayStart = (notify) => {
  let timeoutId;

  const scheduleNextMidnight = () => {
    const now = new Date();
    const tomorrow = startOfLocalDay(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    timeoutId = window.setTimeout(() => {
      currentDayStartSnapshot = startOfLocalDay();
      notify();
      scheduleNextMidnight();
    }, Math.max(1000, tomorrow.getTime() - now.getTime()));
  };

  scheduleNextMidnight();
  return () => window.clearTimeout(timeoutId);
};

export const useCurrentLocalDayStart = () => {
  return useSyncExternalStore(
    subscribeToCurrentDayStart,
    getCurrentDayStartSnapshot,
    getCurrentDayStartSnapshot,
  );
};
