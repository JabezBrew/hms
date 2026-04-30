import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import FileCheck2 from 'lucide-react/dist/esm/icons/file-check-2.js';
import TestTube2 from 'lucide-react/dist/esm/icons/test-tube-diagonal.js';
import Users from 'lucide-react/dist/esm/icons/users.js';
import { cn } from '@/lib/utils';

const METRIC_STYLES = {
  rose: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300',
  amber: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300',
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300',
  sky: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-300',
  stone: 'border-border bg-muted/50 text-muted-foreground',
};

export function MetricStrip({ summary, className }) {
  const metrics = [
    {
      label: 'Patients',
      value: summary.totalPatients,
      helper: `${summary.visiblePatients} visible`,
      icon: Users,
      accent: 'sky',
    },
    {
      label: 'Open Tasks',
      value: summary.openTasks,
      helper: 'Active ward work',
      icon: ClipboardList,
      accent: 'amber',
    },
    {
      label: 'Urgent',
      value: summary.critical,
      helper: 'Needs attention',
      icon: AlertTriangle,
      accent: summary.critical > 0 ? 'rose' : 'stone',
    },
    {
      label: 'Results',
      value: summary.pendingResults,
      helper: 'Awaiting review',
      icon: TestTube2,
      accent: 'sky',
    },
    {
      label: 'Discharge',
      value: summary.dischargeReady,
      helper: 'Ready or pending',
      icon: FileCheck2,
      accent: 'emerald',
    },
  ];

  return (
    <section className={cn('grid grid-cols-2 gap-3 md:grid-cols-5', className)} aria-label="Ward board metrics">
      {metrics.map((metric) => {
        const Icon = metric.icon;
        return (
          <article key={metric.label} className="rounded-lg border border-border bg-card/70 p-3 shadow-sm">
            <div className="flex items-center gap-2">
              <span className={cn('flex h-8 w-8 items-center justify-center rounded-md border', METRIC_STYLES[metric.accent])}>
                <Icon className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="truncate font-mono text-[10px] uppercase text-muted-foreground">
                  {metric.label}
                </p>
                <p className="truncate text-xs text-muted-foreground">{metric.helper}</p>
              </div>
            </div>
            <p className="mt-3 font-display text-3xl leading-none text-foreground">{metric.value ?? 0}</p>
          </article>
        );
      })}
    </section>
  );
}
