import { Link } from 'react-router-dom';
import { formatSeriesTime } from './model';
export function SeriesMembers({ series }) {
  const appointments = [...series.appointments].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || a.id.localeCompare(b.id));
  return <section aria-label="Saved appointments" className="grid gap-3">
    <p className="text-sm font-medium">{series.patient_display_name} · {series.clinic_name} · {series.service_name}</p>
    <ul className="divide-y rounded-xl border bg-card">{appointments.map((member) => <li key={member.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm"><div className="min-w-0 break-words"><p>{formatSeriesTime(member.starts_at)}</p><p className="mt-1 text-xs text-muted-foreground">{member.status}</p>{member.cancellation_reason && <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{member.cancellation_reason}</p>}</div><Link to={`/appointments/${member.id}`} className="rounded-md px-3 py-2 text-sm font-medium text-primary underline-offset-4 hover:underline">View appointment</Link></li>)}</ul>
  </section>;
}
