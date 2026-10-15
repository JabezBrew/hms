import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js'
import Search from 'lucide-react/dist/esm/icons/search.js'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { LoadingSpinner } from '@/components/ui/loading-spinner'
import { Skeleton } from '@/components/ui/skeleton'
import { useId } from 'react'

const DEFAULT_TITLES = {
  loading: 'Loading',
  error: 'Something went wrong',
  empty: 'No results',
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
  const titleId = useId()
  if (!variant) {
    return null
  }

  if (variant === 'loading') {
    return (
      <div role="status" aria-live="polite" aria-label={title || DEFAULT_TITLES.loading} className={cn('bg-background p-4 sm:p-6 space-y-6', fullHeight && 'min-h-[var(--page-min-height,100svh)] flex-1', className)}>
        {children || (
          <>
            <p className="sr-only">{title || DEFAULT_TITLES.loading}</p>
            <LoadingSpinner className="h-6 w-12 text-primary" aria-hidden="true" />
            <Skeleton className="h-12 w-64 max-w-full" />
            <div className="flex gap-4">
              <Skeleton className="h-10 flex-1 max-w-md" />
              <Skeleton className="h-10 w-40" />
            </div>
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-20 rounded-xl" />
              ))}
            </div>
          </>
        )}
      </div>
    )
  }

  const ResolvedIcon = Icon || (variant === 'error' ? AlertTriangle : Search)
  const resolvedTitle = title || DEFAULT_TITLES[variant]

  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      aria-labelledby={titleId}
      className={cn(
        'bg-background p-6 flex items-center justify-center',
        fullHeight && 'min-h-[var(--page-min-height,100svh)] flex-1',
        className,
      )}
    >
      <div className="max-w-md text-center space-y-4">
        <div className="size-16 rounded-full bg-muted/60 flex items-center justify-center mx-auto">
          {ResolvedIcon ? <ResolvedIcon className="size-8 text-muted-foreground" aria-hidden="true" /> : null}
        </div>
        <div>
          <h2 id={titleId} className="font-display text-2xl font-semibold text-foreground">{resolvedTitle}</h2>
          {description ? (
            <p className="text-muted-foreground mt-1">{description}</p>
          ) : null}
        </div>
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
    <div role="status" aria-live="polite" aria-label={DEFAULT_TITLES.loading} className={cn('bg-background p-4 sm:p-6 space-y-6 min-h-[var(--page-min-height,100svh)] flex-1', className)}>
      <p className="sr-only">{DEFAULT_TITLES.loading}</p>
      <LoadingSpinner className="h-6 w-12 text-primary" aria-hidden="true" />
      <Skeleton className="h-12 w-64 max-w-full" />
      <div className="flex gap-4">
        <Skeleton className="h-10 flex-1 max-w-md" />
        <Skeleton className="h-10 w-40" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
    </div>
  )
}
