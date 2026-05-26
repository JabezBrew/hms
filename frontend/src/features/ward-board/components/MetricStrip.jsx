import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import FileCheck2 from 'lucide-react/dist/esm/icons/file-check-2.js';
import FlaskConical from 'lucide-react/dist/esm/icons/flask-conical.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import { cn } from '@/lib/utils';

function Metric({ icon: Icon, label, value, accent }) {
  const accents = {
    neutral: 'text-foreground',
    rose: 'text-rose-600',
    amber: 'text-amber-600',
    emerald: 'text-emerald-600',
    sky: 'text-sky-600',
  };
  return (
    <div className="flex items-center gap-2.5">
      <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/60', accents[accent])}>
        <Icon className="size-3.5" aria-hidden="true" />
      </span>
      <div>
        <p className={cn('font-mono text-xl font-semibold leading-none tabular-nums', accents[accent])}>
          {value ?? 0}
        </p>
        <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

export function MetricStrip({ summary, className }) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border border-border bg-card/60 px-4 py-3',
        className
      )}
      aria-label="Ward board metrics"
    >
      <Metric icon={Users} label="Census" value={summary.totalPatients} accent="neutral" />

      <span className="h-6 w-px shrink-0 bg-border" aria-hidden="true" />

      <Metric
        icon={AlertTriangle}
        label="Critical"
        value={summary.critical}
        accent={summary.critical > 0 ? 'rose' : 'neutral'}
      />
      <Metric
        icon={Clock}
        label="Overdue"
        value={summary.overdue ?? summary.openTasks}
        accent={summary.overdue > 0 ? 'amber' : 'neutral'}
      />

      <span className="h-6 w-px shrink-0 bg-border" aria-hidden="true" />

      <Metric icon={FlaskConical} label="Pending Results" value={summary.pendingResults} accent="sky" />
      <Metric icon={FileCheck2} label="Reviews" value={summary.myWork} accent="amber" />
      <Metric icon={FileCheck2} label="Discharge Blockers" value={summary.dischargeReady} accent="emerald" />
    </div>
  );
}
