import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import FlaskConical from 'lucide-react/dist/esm/icons/flask-conical.js';
import Settings2 from 'lucide-react/dist/esm/icons/settings-2.js';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import {
  URGENCY_STYLES,
  getAbnormalResults,
  getOverdueTaskList,
  getPatientBed,
  getPatientId,
  getPatientName,
  getPatientUrgency,
  getTaskTitle,
  formatTime,
  patientChronicleHref,
} from './wardBoardUtils';

function SectionHeader({ icon: Icon, label, count, accent }) {
  const accents = {
    rose: 'text-rose-600',
    amber: 'text-amber-600',
    sky: 'text-sky-600',
  };
  return (
    <div className="flex items-center justify-between gap-2 pb-2">
      <div className="flex items-center gap-1.5">
        <Icon className={cn('size-3.5', accents[accent])} aria-hidden="true" />
        <h3 className={cn('font-mono text-[11px] font-semibold uppercase tracking-wide', accents[accent])}>
          {label}
          {count != null ? ` (${count})` : ''}
        </h3>
      </div>
      <button type="button" className="font-mono text-[10px] text-muted-foreground hover:text-amber-700">
        View all
      </button>
    </div>
  );
}

export function WatchlistPanel({ patients, boardData, className }) {
  const critical = patients.filter((p) => ['critical', 'urgent', 'high'].includes(getPatientUrgency(p)));
  const abnormal = getAbnormalResults(boardData, patients);
  const overdue = getOverdueTaskList(boardData, patients);

  return (
    <aside
      className={cn(
        'flex flex-col gap-0 border-t border-border bg-card/40 lg:border-l lg:border-t-0',
        className
      )}
    >
      <div className="flex h-12 items-center justify-between gap-2 border-b border-border px-4">
        <h2 className="font-heading text-sm font-semibold text-foreground">Watchlist</h2>
        <Settings2 className="size-3.5 text-muted-foreground" aria-hidden="true" />
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        <section>
          <SectionHeader icon={AlertTriangle} label="Critical Patients" count={critical.length} accent="rose" />
          {critical.length === 0 ? (
            <p className="font-mono text-[11px] text-muted-foreground">No critical patients</p>
          ) : (
            <div className="space-y-1">
              {critical.slice(0, 5).map((patient, index) => {
                const patientId = getPatientId(patient) ?? index;
                const bed = getPatientBed(patient);
                const urgency = getPatientUrgency(patient);
                return (
                  <Link
                    key={patientId}
                    to={patientChronicleHref(patient)}
                    className="group flex items-center gap-2 rounded-md px-1 py-1.5 transition-colors hover:bg-rose-50/60"
                  >
                    {bed ? (
                      <span className="shrink-0 w-9 font-mono text-[10px] font-medium text-muted-foreground">{bed}</span>
                    ) : null}
                    <span className="min-w-0 flex-1 truncate font-display text-sm text-foreground group-hover:text-rose-700">
                      {getPatientName(patient)}
                    </span>
                    <span className={cn(
                      'shrink-0 rounded-sm border px-1 font-mono text-[9px] capitalize',
                      URGENCY_STYLES[urgency] ?? URGENCY_STYLES.critical
                    )}>
                      {urgency}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        <div className="h-px bg-border" />

        <section>
          <SectionHeader icon={FlaskConical} label="Abnormal Unacknowledged Results" count={abnormal.length} accent="sky" />
          {abnormal.length === 0 ? (
            <p className="font-mono text-[11px] text-muted-foreground">No abnormal results</p>
          ) : (
            <div className="space-y-1">
              {abnormal.slice(0, 5).map((result, index) => (
                <div key={result?.id ?? index} className="flex items-center gap-2 p-1">
                  <span className="shrink-0 w-9 font-mono text-[10px] font-medium text-muted-foreground">
                    {result?._bed ?? '—'}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">
                    {result?.name ?? result?.test_name ?? 'Result'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="h-px bg-border" />

        <section>
          <SectionHeader icon={Clock} label="Overdue Tasks" count={overdue.length} accent="amber" />
          {overdue.length === 0 ? (
            <p className="font-mono text-[11px] text-muted-foreground">No overdue tasks</p>
          ) : (
            <div className="space-y-1">
              {overdue.slice(0, 7).map((task, index) => (
                <div key={task?.id ?? index} className="flex items-center gap-2 p-1">
                  <span className="shrink-0 w-9 font-mono text-[10px] font-medium text-muted-foreground">
                    {task?._bed ?? '—'}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">
                    {getTaskTitle(task)}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-rose-600">
                    {formatTime(task?.due_at ?? task?.due_time) ?? '—'}
                  </span>
                </div>
              ))}
              {overdue.length > 7 ? (
                <p className="px-1 font-mono text-[10px] text-muted-foreground">+{overdue.length - 7} more</p>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}
