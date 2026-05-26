import Search from 'lucide-react/dist/esm/icons/search.js';

import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { PageState } from '@/shared/components/page/PageState';

const ACCENT_STYLES = {
  amber: {
    iconWrap: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300',
    value: 'text-amber-700 dark:text-amber-300',
  },
  emerald: {
    iconWrap: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300',
    value: 'text-emerald-700 dark:text-emerald-300',
  },
  rose: {
    iconWrap: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300',
    value: 'text-rose-700 dark:text-rose-300',
  },
  sky: {
    iconWrap: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-300',
    value: 'text-sky-700 dark:text-sky-300',
  },
  stone: {
    iconWrap: 'border-border bg-muted/50 text-muted-foreground',
    value: 'text-foreground',
  },
};

export function LabMetricGrid({ metrics, className }) {
  return (
    <div className={cn('grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4', className)}>
      {metrics.map((metric, index) => (
        <LabMetricCard key={metric.label} metric={metric} index={index} />
      ))}
    </div>
  );
}

function LabMetricCard({ metric, index }) {
  const Icon = metric.icon;
  const styles = ACCENT_STYLES[metric.color] || ACCENT_STYLES.stone;

  return (
    <article
      className={cn(
        'animate-chronicle-enter rounded-lg border border-border bg-card/60 p-4 shadow-sm',
        'transition-colors hover:border-primary/30',
        metric.className
      )}
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <div className="flex items-center gap-3">
        {Icon ? (
          <div className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg border', styles.iconWrap)}>
            <Icon className="size-4" aria-hidden="true" />
          </div>
        ) : null}
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            {metric.label}
          </p>
          {metric.description ? (
            <p className="truncate text-xs text-muted-foreground">{metric.description}</p>
          ) : null}
        </div>
      </div>
      <p className={cn('mt-3 font-display text-3xl leading-none text-foreground', metric.accentValue && styles.value)}>
        {metric.value}
      </p>
    </article>
  );
}

export function LabToolbar({ children, className }) {
  return (
    <section className={cn('border-b border-border bg-card/50 p-4 sm:px-6', className)}>
      {children}
    </section>
  );
}

export function LabSearchField({
  value,
  onChange,
  placeholder,
  id,
  className,
}) {
  return (
    <div className={cn('relative min-w-0 flex-1', className)}>
      <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input
        id={id}
        type="search"
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        className="h-10 pl-10 font-mono text-sm"
      />
    </div>
  );
}

export function LabEmptyState({
  icon,
  title,
  description,
  action,
  className,
}) {
  return (
    <PageState
      variant="empty"
      icon={icon}
      title={title}
      description={description}
      action={action}
      fullHeight={false}
      className={cn('min-h-[320px] bg-transparent px-4 py-16', className)}
    />
  );
}

export function LabTableSkeleton({ rows = 6, className }) {
  return (
    <div className={cn('space-y-3 rounded-lg border border-border bg-card/50 p-4', className)}>
      <Skeleton className="h-10 w-full rounded-lg" />
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className="h-14 w-full rounded-lg" />
      ))}
    </div>
  );
}

export const labTableClassName = 'min-w-[1120px] rounded-lg bg-card/70';
export const labTableHeaderClassName = 'border-b border-border bg-muted/50 font-mono uppercase tracking-widest';
