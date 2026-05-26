import React from 'react';
import { cn } from '@/lib/utils';

/**
 * DashboardSection - Reusable section wrapper for dashboard pages
 *
 * @param {Object} props
 * @param {string} props.title - Section title
 * @param {string} props.subtitle - Optional subtitle
 * @param {ReactNode} props.actions - Optional action buttons
 * @param {ReactNode} props.children - Section content
 * @param {string} props.className - Additional CSS classes
 * @param {boolean} props.collapsible - Whether section can be collapsed
 * @param {boolean} props.defaultCollapsed - Default collapsed state
 */
export default function DashboardSection({
  title,
  subtitle,
  actions,
  children,
  className,
  collapsible = false,
  defaultCollapsed = false,
}) {
  const [isCollapsed, setIsCollapsed] = React.useState(defaultCollapsed);

  return (
    <section className={cn('mb-6 sm:mb-8', className)}>
      {/* Section header */}
      <div className="flex items-start justify-between mb-4 sm:mb-6">
        <button
          type="button"
          disabled={!collapsible}
          className={cn(
            'flex-1 text-left disabled:cursor-default',
            collapsible && 'cursor-pointer'
          )}
          onClick={() => setIsCollapsed(!isCollapsed)}
        >
          <h2 className="font-heading text-xl sm:text-2xl font-semibold text-foreground mb-1">
            {title}
          </h2>
          {subtitle && (
            <p className="text-sm sm:text-base text-muted-foreground">
              {subtitle}
            </p>
          )}
        </button>

        {/* Actions */}
        {actions && (
          <div className="flex gap-2 ml-4">
            {actions}
          </div>
        )}
      </div>

      {/* Section content */}
      {!isCollapsed && (
        <div className="space-y-4">
          {children}
        </div>
      )}
    </section>
  );
}

/**
 * DashboardGrid - Grid layout for dashboard cards
 *
 * @param {Object} props
 * @param {ReactNode} props.children - Grid items
 * @param {string} props.columns - Column configuration: '1', '2', '3', '4' (default: '3')
 * @param {string} props.className - Additional CSS classes
 */
export function DashboardGrid({ children, columns = '3', className }) {
  const columnConfig = {
    '1': 'grid-cols-1',
    '2': 'grid-cols-1 md:grid-cols-2',
    '3': 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3',
    '4': 'grid-cols-1 md:grid-cols-2 xl:grid-cols-4',
  };

  return (
    <div className={cn(
      'grid gap-4 sm:gap-6',
      columnConfig[columns],
      className
    )}>
      {children}
    </div>
  );
}
