import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js'
import Search from 'lucide-react/dist/esm/icons/search.js'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

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
  if (!variant) {
    return null
  }

  if (variant === 'loading') {
    return (
      <div className={cn('bg-background p-4 sm:p-6 space-y-6', fullHeight && 'min-h-screen', className)}>
        {children || (
          <>
            <p className="sr-only">{DEFAULT_TITLES.loading}</p>
            <Skeleton className="h-12 w-64" />
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
      className={cn(
        'bg-background p-6 flex items-center justify-center',
        fullHeight && 'min-h-screen',
        className,
      )}
    >
      <div className="text-center space-y-4">
        <div className="size-16 rounded-full bg-muted/60 flex items-center justify-center mx-auto">
          {ResolvedIcon ? <ResolvedIcon className="size-8 text-muted-foreground" /> : null}
        </div>
        <div>
          <h2 className="font-display text-2xl text-foreground">{resolvedTitle}</h2>
          {description ? (
            <p className="text-muted-foreground mt-1">{description}</p>
          ) : null}
        </div>
        {action ? (
          <div className="flex items-center justify-center">
            {typeof action === 'function' ? (
              <Button onClick={action} className="font-mono text-xs">
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
    <div className={cn('bg-background p-4 sm:p-6 space-y-6 min-h-screen', className)}>
      <p className="sr-only">{DEFAULT_TITLES.loading}</p>
      <Skeleton className="h-12 w-64" />
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
