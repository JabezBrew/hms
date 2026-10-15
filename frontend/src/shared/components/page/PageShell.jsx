import { cn } from '@/lib/utils'

export function PageShell({ children, className, ...props }) {
  return (
    <div data-page-shell className={cn('min-h-[var(--page-min-height,100svh)] min-w-0 flex-1 bg-background', className)} {...props}>
      {children}
    </div>
  )
}
