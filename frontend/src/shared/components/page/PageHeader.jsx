import { cn } from '@/lib/utils'

const SIZE_STYLES = {
  md: {
    padding: 'px-4 sm:px-6 py-4 sm:py-6',
    title: 'text-2xl sm:text-3xl lg:text-4xl',
    description: 'text-sm text-muted-foreground',
    meta: 'font-mono text-xs text-muted-foreground uppercase tracking-widest',
  },
  lg: {
    padding: 'px-4 py-6 sm:px-6 sm:py-8',
    title: 'text-3xl sm:text-4xl',
    description: 'text-muted-foreground mt-2',
    meta: 'font-mono text-xs text-muted-foreground uppercase tracking-widest mb-2',
  },
}

export function PageHeader({
  title,
  description,
  meta,
  actions,
  children,
  className,
  contentClassName,
  titleClassName,
  descriptionClassName,
  metaClassName,
  size = 'md',
  wrap = true,
}) {
  const styles = SIZE_STYLES[size] || SIZE_STYLES.md

  const content = (
    <div className={cn('flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between', contentClassName)}>
      <div className="min-w-0 space-y-1">
        {meta ? (
          <p className={cn(styles.meta, metaClassName)}>{meta}</p>
        ) : null}
        {title ? (
          <h1 className={cn('break-words font-display font-semibold leading-tight text-foreground tracking-tight', styles.title, titleClassName)}>
            {title}
          </h1>
        ) : null}
        {description ? (
          <div className={cn(styles.description, descriptionClassName)}>{description}</div>
        ) : null}
        {children}
      </div>
      {actions ? <div className="w-full min-w-0 sm:w-auto sm:shrink-0">{actions}</div> : null}
    </div>
  )

  if (!wrap) {
    return content
  }

  return (
    <header className={cn('bg-card border-b border-border', styles.padding, className)}>
      {content}
    </header>
  )
}
