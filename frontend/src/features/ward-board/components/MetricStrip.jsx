import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import FileCheck2 from 'lucide-react/dist/esm/icons/file-check-2.js';
import FlaskConical from 'lucide-react/dist/esm/icons/flask-conical.js';
import Pill from 'lucide-react/dist/esm/icons/pill.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import { cn } from '@/lib/utils';

const METRIC_ACCENTS = {
  neutral: 'text-foreground',
  rose: 'text-rose-600',
  amber: 'text-amber-600',
  emerald: 'text-emerald-600',
  sky: 'text-sky-600',
};

function Metric({ icon: Icon, label, value, accent }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-md bg-muted/60', METRIC_ACCENTS[accent])}>
        <Icon className="size-3.5" aria-hidden="true" />
      </span>
      <div>
        <p className={cn('font-mono text-xl font-semibold leading-none tabular-nums', METRIC_ACCENTS[accent])}>
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
        'flex flex-wrap items-center gap-x-5 gap-y-3 rounded-lg border border-border bg-card/70 px-4 py-3',
        className
      )}
      aria-label="Ward board metrics"
    >
      <Metric icon={Users} label="Census" value={summary.totalPatients} accent="neutral" />

      <span className="hidden h-6 w-px shrink-0 bg-border sm:block" aria-hidden="true" />

      <Metric
        icon={AlertTriangle}
        label="Safety"
        value={summary.safety}
        accent={summary.criticalSafety > 0 ? 'rose' : summary.safety > 0 ? 'amber' : 'neutral'}
      />
      <Metric
        icon={Clock}
        label="Open Tasks"
        value={summary.openTasks}
        accent={summary.openTasks > 0 ? 'amber' : 'neutral'}
      />
      <Metric
        icon={Pill}
        label="Meds Due"
        value={summary.dueMedications}
        accent={summary.dueMedications > 0 ? 'amber' : 'neutral'}
      />

      <span className="hidden h-6 w-px shrink-0 bg-border sm:block" aria-hidden="true" />

      <Metric
        icon={FlaskConical}
        label="Pending Results"
        value={summary.pendingResults}
        accent={summary.pendingResults > 0 ? 'sky' : 'neutral'}
      />
      <Metric
        icon={FileCheck2}
        label="Discharge Blockers"
        value={summary.dischargeBlockers}
        accent={summary.dischargeBlockers > 0 ? 'amber' : 'neutral'}
      />
    </div>
  );
}
