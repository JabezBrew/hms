export const EMPTY_SELECT_VALUE = '__none__';
export const ANY_SERVICE_VALUE = '__any_service__';

export const todayIso = () => new Date().toISOString().slice(0, 10);

export function isoDateFromDate(date) {
  if (!date) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function dateFromIso(value) {
  if (!value) return undefined;
  return new Date(`${value}T00:00:00`);
}

export const initialSessionForm = () => ({
  name: '',
  clinic_id: '',
  service_id: '',
  mode: 'capacity_block',
  date: todayIso(),
  start_time: '08:00',
  end_time: '12:00',
  capacity: 20,
  slot_minutes: 30,
  allow_overbooking: false,
  overbook_limit: 0,
});

export const initialExceptionForm = () => ({
  session_id: '',
  date: todayIso(),
  start_time: '08:00',
  end_time: '12:00',
  reason: '',
});

const sessionTimeFormatter = new Intl.DateTimeFormat('en', {
  hour: '2-digit',
  minute: '2-digit',
  day: '2-digit',
  month: 'short',
});

export function formatDateTime(value) {
  if (!value) return 'Unscheduled';
  return sessionTimeFormatter.format(new Date(value));
}

export function toUtcIso(date, time) {
  return new Date(`${date}T${time}:00`).toISOString();
}

export function sessionStatus(session) {
  if (!session?.is_active) return 'cancelled';
  if ((session.remaining_capacity || 0) > 0) return 'open';
  if ((session.overbook_remaining || 0) > 0) return 'overbook';
  return 'full';
}

export function statusClass(status) {
  switch (status) {
    case 'open':
      return 'badge-chronicle-emerald';
    case 'overbook':
      return 'badge-chronicle-amber';
    case 'full':
      return 'badge-chronicle-rose';
    default:
      return 'bg-muted text-muted-foreground';
  }
}
