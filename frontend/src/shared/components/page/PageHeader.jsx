import { cn } from '@/lib/utils'

const SIZE_STYLES = {
  md: {
    padding: 'px-4 sm:px-6 py-4 sm:py-6',
    title: 'text-3xl sm:text-4xl',
    description: 'mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground',
    meta: 'mb-1 text-xs font-medium text-muted-foreground',
  },
  lg: {
    padding: 'px-4 sm:px-6 py-6 sm:py-8',
    title: 'text-4xl sm:text-5xl',
    description: 'mt-2 max-w-2xl text-sm sm:text-base leading-relaxed text-muted-foreground',
    meta: 'mb-2 text-xs font-medium text-muted-foreground',
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
    <div className={cn('flex min-w-0 flex-col gap-4 md:flex-row md:items-start md:justify-between', contentClassName)}>
      <div className="min-w-0">
        {meta ? (
          <p className={cn(styles.meta, metaClassName)}>{meta}</p>
        ) : null}
        {title ? (
          <h1 className={cn('font-display font-medium text-foreground tracking-tight leading-tight break-words', styles.title, titleClassName)}>
            {title}
          </h1>
        ) : null}
        {description ? (
          <div className={cn(styles.description, descriptionClassName)}>{description}</div>
        ) : null}
        {children}
      </div>
      {actions ? <div className="flex w-full min-w-0 flex-wrap items-center gap-2 md:w-auto md:max-w-[50%] md:justify-end">{actions}</div> : null}
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
