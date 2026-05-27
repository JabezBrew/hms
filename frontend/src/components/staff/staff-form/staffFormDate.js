import { useSyncExternalStore } from 'react';

export const MIN_STAFF_DATE = new Date('1900-01-01');

const isSameLocalDay = (left, right) => (
  left.getFullYear() === right.getFullYear() &&
  left.getMonth() === right.getMonth() &&
  left.getDate() === right.getDate()
);

let currentDateSnapshot = new Date();

const getCurrentDateSnapshot = () => {
  const now = new Date();
  if (!isSameLocalDay(now, currentDateSnapshot)) {
    currentDateSnapshot = now;
  }
  return currentDateSnapshot;
};

const subscribeToCurrentDate = (notify) => {
  let timeoutId;

  const scheduleNextMidnight = () => {
    const now = new Date();
    const nextMidnight = new Date(now);
    nextMidnight.setHours(24, 0, 0, 0);
    timeoutId = window.setTimeout(() => {
      currentDateSnapshot = new Date();
      notify();
      scheduleNextMidnight();
    }, Math.max(1000, nextMidnight.getTime() - now.getTime()));
  };

  scheduleNextMidnight();
  return () => window.clearTimeout(timeoutId);
};

export const useCurrentDate = () => {
  return useSyncExternalStore(
    subscribeToCurrentDate,
    getCurrentDateSnapshot,
    getCurrentDateSnapshot
  );
};
