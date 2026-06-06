import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import FileCheck2 from 'lucide-react/dist/esm/icons/file-check-2.js';
import FlaskConical from 'lucide-react/dist/esm/icons/flask-conical.js';
import Settings2 from 'lucide-react/dist/esm/icons/settings-2.js';
import { cn } from '@/lib/utils';
import {
  URGENCY_STYLES,
  getAbnormalResults,
  getDischargeBlockerList,
  getOverdueTaskList,
  getPatientBed,
  getPatientId,
  getPatientName,
  getPatientUrgency,
  getTaskTitle,
  formatTime,
} from './wardBoardUtils';

const SECTION_ACCENTS = {
  rose: 'text-rose-600',
  amber: 'text-amber-600',
  sky: 'text-sky-600',
};

function SectionHeader({ icon: Icon, label, count, accent, onViewAll }) {
  const canView = count > 0 && onViewAll;
  return (
    <div className="flex items-center justify-between gap-2 pb-2">
      <div className="flex items-center gap-1.5">
        <Icon className={cn('size-3.5', SECTION_ACCENTS[accent])} aria-hidden="true" />
        <h3 className={cn('font-mono text-[11px] font-semibold uppercase tracking-wide', SECTION_ACCENTS[accent])}>
          {label}
          {count != null ? ` (${count})` : ''}
        </h3>
      </div>
      <button
        type="button"
        disabled={!canView}
        onClick={onViewAll}
        className="font-mono text-[10px] text-muted-foreground transition-colors enabled:hover:text-amber-700 disabled:opacity-40"
      >
        View all
      </button>
    </div>
  );
}

function QuietEmpty({ children }) {
  return (
    <p className="rounded-md border border-dashed border-border/70 px-3 py-2 font-mono text-[11px] text-muted-foreground">
      {children}
    </p>
  );
}

function WatchlistButton({ patientId, onOpenPatient, className, children }) {
  const interactive = Boolean(patientId && onOpenPatient);

  return (
    <button
      type="button"
      disabled={!interactive}
      onClick={() => onOpenPatient?.(patientId)}
      className={cn(
        'group flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left transition-colors',
        interactive ? 'hover:bg-amber-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500' : 'cursor-default',
        className
      )}
    >
      {children}
    </button>
  );
}

function itemPatientId(item) {
  return item?._patient_id ?? item?.patient_id ?? item?.patient?.id ?? item?.patient_uuid;
}

export function WatchlistPanel({ patients, boardData, onOpenPatient, onViewChange, className }) {
  const critical = patients.filter((p) => ['critical', 'urgent', 'high'].includes(getPatientUrgency(p)));
  const abnormal = getAbnormalResults(boardData, patients);
  const overdue = getOverdueTaskList(boardData, patients);
  const dischargeBlockers = getDischargeBlockerList(boardData, patients);

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
          <SectionHeader
            icon={AlertTriangle}
            label="Critical Patients"
            count={critical.length}
            accent="rose"
            onViewAll={() => onViewChange?.('by-urgency')}
          />
          {critical.length === 0 ? (
            <QuietEmpty>No critical patients</QuietEmpty>
          ) : (
            <div className="space-y-1">
              {critical.slice(0, 5).map((patient, index) => {
                const patientId = getPatientId(patient);
                const bed = getPatientBed(patient);
                const urgency = getPatientUrgency(patient);
                return (
                  <WatchlistButton
                    key={patientId ?? index}
                    patientId={patientId}
                    onOpenPatient={onOpenPatient}
                    className="hover:bg-rose-50/60"
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
                  </WatchlistButton>
                );
              })}
            </div>
          )}
        </section>

        <div className="h-px bg-border" />

        <section>
          <SectionHeader
            icon={FlaskConical}
            label="Abnormal Results"
            count={abnormal.length}
            accent="sky"
            onViewAll={() => onViewChange?.('results')}
          />
          {abnormal.length === 0 ? (
            <QuietEmpty>No abnormal results</QuietEmpty>
          ) : (
            <div className="space-y-1">
              {abnormal.slice(0, 5).map((result, index) => (
                <WatchlistButton
                  key={result?.id ?? index}
                  patientId={itemPatientId(result)}
                  onOpenPatient={onOpenPatient}
                >
                  <span className="shrink-0 w-9 font-mono text-[10px] font-medium text-muted-foreground">
                    {result?._bed ?? '—'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[11px] text-foreground">
                      {result?.name ?? result?.test_name ?? 'Result'}
                    </span>
                    {result?._patient_name ? (
                      <span className="block truncate font-mono text-[10px] text-muted-foreground">{result._patient_name}</span>
                    ) : null}
                  </span>
                </WatchlistButton>
              ))}
            </div>
          )}
        </section>

        <div className="h-px bg-border" />

        <section>
          <SectionHeader
            icon={Clock}
            label="Overdue Tasks"
            count={overdue.length}
            accent="amber"
            onViewAll={() => onViewChange?.('my-work')}
          />
          {overdue.length === 0 ? (
            <QuietEmpty>No overdue tasks</QuietEmpty>
          ) : (
            <div className="space-y-1">
              {overdue.slice(0, 7).map((task, index) => (
                <WatchlistButton
                  key={task?.id ?? index}
                  patientId={itemPatientId(task)}
                  onOpenPatient={onOpenPatient}
                >
                  <span className="shrink-0 w-9 font-mono text-[10px] font-medium text-muted-foreground">
                    {task?._bed ?? '—'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[11px] text-foreground">
                      {getTaskTitle(task)}
                    </span>
                    {task?._patient_name ? (
                      <span className="block truncate font-mono text-[10px] text-muted-foreground">{task._patient_name}</span>
                    ) : null}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-rose-600">
                    {formatTime(task?.due_at ?? task?.due_time) ?? '—'}
                  </span>
                </WatchlistButton>
              ))}
              {overdue.length > 7 ? (
                <p className="px-1 font-mono text-[10px] text-muted-foreground">+{overdue.length - 7} more</p>
              ) : null}
            </div>
          )}
        </section>

        <div className="h-px bg-border" />

        <section>
          <SectionHeader
            icon={FileCheck2}
            label="Discharge Blockers"
            count={dischargeBlockers.length}
            accent="amber"
            onViewAll={() => onViewChange?.('discharge')}
          />
          {dischargeBlockers.length === 0 ? (
            <QuietEmpty>No discharge blockers</QuietEmpty>
          ) : (
            <div className="space-y-1">
              {dischargeBlockers.slice(0, 7).map((item, index) => (
                <WatchlistButton
                  key={item?.id ?? item?.key ?? index}
                  patientId={itemPatientId(item)}
                  onOpenPatient={onOpenPatient}
                >
                  <span className="shrink-0 w-9 font-mono text-[10px] font-medium text-muted-foreground">
                    {item?._bed ?? '—'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[11px] text-foreground">
                      {item?.title ?? item?.label ?? item?.summary ?? 'Discharge item'}
                    </span>
                    {item?._patient_name || item?.owner ? (
                      <span className="block truncate font-mono text-[10px] text-muted-foreground">
                        {item?._patient_name ?? item.owner}
                      </span>
                    ) : null}
                  </span>
                </WatchlistButton>
              ))}
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}
