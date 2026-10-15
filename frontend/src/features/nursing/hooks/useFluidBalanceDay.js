import { useEffect, useState } from 'react';
import format from 'date-fns/format';

const currentDay = (utc) => utc ? new Date().toISOString().slice(0, 10) : format(new Date(), 'yyyy-MM-dd');

/** Keep a displayed fluid day current while its patient panel remains open. */
export function useFluidBalanceDay({ utc, enabled = true }) {
  const [day, setDay] = useState(() => currentDay(utc));
  useEffect(() => {
    if (!enabled) return undefined;
    let timer;
    const schedule = () => {
      const now = new Date();
      const next = utc
        ? Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
        : new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
      timer = setTimeout(() => {
        setDay(currentDay(utc));
        schedule();
      }, Math.max(1, next - now.getTime()));
    };
    schedule();
    return () => clearTimeout(timer);
  }, [utc, enabled]);
  // Reopening a panel or a form edit also resolves a changed calendar day.
  return day === currentDay(utc) ? day : currentDay(utc);
}
