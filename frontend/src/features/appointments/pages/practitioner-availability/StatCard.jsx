import { cn } from '@/lib/utils';

export function StatCard({ icon: Icon, label, value, sublabel, color = 'amber' }) {
  const colorClasses = {
    amber: {
      bg: 'bg-amber-100 dark:bg-amber-900/30',
      icon: 'text-amber-600 dark:text-amber-400',
      value: 'text-amber-600 dark:text-amber-400',
    },
    emerald: {
      bg: 'bg-emerald-100 dark:bg-emerald-900/30',
      icon: 'text-emerald-600 dark:text-emerald-400',
      value: 'text-emerald-600 dark:text-emerald-400',
    },
    rose: {
      bg: 'bg-rose-100 dark:bg-rose-900/30',
      icon: 'text-rose-600 dark:text-rose-400',
      value: 'text-rose-600 dark:text-rose-400',
    },
    sky: {
      bg: 'bg-sky-100 dark:bg-sky-900/30',
      icon: 'text-sky-600 dark:text-sky-400',
      value: 'text-sky-600 dark:text-sky-400',
    },
  };
  const colors = colorClasses[color] || colorClasses.amber;

  return (
    <div className="bg-background/50 rounded-xl p-4 border border-border/50 hover:border-border transition-colors">
      <div className="flex items-center gap-3">
        <div className={cn('p-2.5 rounded-lg', colors.bg)}>
          <Icon className={cn('size-5', colors.icon)} />
        </div>
        <div className="min-w-0">
          <p className={cn('font-display text-2xl font-bold tabular-nums', colors.value)}>{value}</p>
          <p className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider truncate">
            {label}
          </p>
          {sublabel && (
            <p className="font-mono text-[10px] text-muted-foreground/70">{sublabel}</p>
          )}
        </div>
      </div>
    </div>
  );
}
