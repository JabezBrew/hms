import { cn } from '@/lib/utils'

export function PageShell({ children, className, ...props }) {
  return (
    <div data-page-shell className={cn('min-h-screen bg-background', className)} {...props}>
      {children}
    </div>
  )
}
