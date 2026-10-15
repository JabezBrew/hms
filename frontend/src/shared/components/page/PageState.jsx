import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js'
import Search from 'lucide-react/dist/esm/icons/search.js'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { LoadingSpinner } from '@/components/ui/loading-spinner'
import { Skeleton } from '@/components/ui/skeleton'

const DEFAULT_TITLES = {
  loading: 'Loading',
  error: 'Something went wrong',
  empty: 'No results',
}

function LoadingSkeleton({ rows = 4 }) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-6">
      <LoadingSpinner className="h-6 w-12 text-primary" />
      <Skeleton className="h-10 w-full max-w-64" />
      <div className="flex flex-col gap-3 sm:flex-row">
        <Skeleton className="h-10 w-full max-w-md" />
        <Skeleton className="h-10 w-32" />
      </div>
      <div className="flex flex-col gap-3">
        {Array.from({ length: rows }).map((_, index) => (
          <Skeleton key={index} className="h-16 rounded-lg" />
        ))}
      </div>
    </div>
  )
}

export function PageState({
  variant,
  title,
  description,
  action,
  icon: Icon,
  className,
  fullHeight = true,
  children,
}) {
  if (!variant) {
    return null
  }

  if (variant === 'loading') {
    return (
      <div
        role="status"
        aria-live="polite"
        className={cn('min-w-0 bg-background p-4 sm:p-6', fullHeight && 'min-h-[calc(100svh-12rem)]', className)}
      >
        <p className="sr-only">{title || DEFAULT_TITLES.loading}</p>
        {children || <LoadingSkeleton />}
      </div>
    )
  }

  const ResolvedIcon = Icon || (variant === 'error' ? AlertTriangle : Search)
  const resolvedTitle = title || DEFAULT_TITLES[variant]

  return (
    <div
      role={variant === 'error' ? 'alert' : undefined}
      className={cn(
        'min-w-0 bg-background px-4 py-8 sm:p-8 flex items-center justify-center',
        fullHeight && 'min-h-[calc(100svh-12rem)]',
        className,
      )}
    >
      <div className="flex w-full max-w-md flex-col items-center gap-4 text-center">
        <div className="flex size-12 items-center justify-center rounded-xl border border-border bg-card">
          {ResolvedIcon ? <ResolvedIcon aria-hidden="true" className="size-5 text-muted-foreground" /> : null}
        </div>
        <div>
          <h2 className="font-heading text-lg font-semibold text-foreground">{resolvedTitle}</h2>
          {description ? (
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {children}
        {action ? (
          <div className="flex items-center justify-center">
            {typeof action === 'function' ? (
              <Button onClick={action}>
                Retry
              </Button>
            ) : (
              action
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function PageLoader({ rows = 6, className }) {
  return (
    <PageState variant="loading" className={className}>
      <LoadingSkeleton rows={rows} />
    </PageState>
  )
}
