import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

import { cn } from '@/lib/utils';

/**
 * ActionCard - Card for actionable items (patients, appointments, tasks)
 *
 * @param {Object} props
 * @param {string} props.title - Card title (e.g., patient name)
 * @param {string} props.subtitle - Subtitle (e.g., MRN, bed number)
 * @param {string} props.description - Description or additional info
 * @param {Array} props.badges - Array of badge objects { text, color }
 * @param {Array} props.metadata - Array of metadata items { label, value, icon }
 * @param {Array} props.actions - Array of action buttons { label, onClick, variant }
 * @param {string} props.status - Status indicator color: 'critical', 'warning', 'stable', 'info'
 * @param {Function} props.onClick - Card click handler
 * @param {ReactNode} props.icon - Optional icon component
 * @param {string} props.className - Additional CSS classes
 */
export default function ActionCard({
  title,
  subtitle,
  description,
  badges = [],
  metadata = [],
  actions = [],
  status,
  onClick,
  icon: Icon,
  className,
}) {
  const statusConfig = {
    critical: {
      ribbon: 'status-ribbon-critical',
      border: 'border-rose-500/30',
    },
    warning: {
      ribbon: 'status-ribbon-warning',
      border: 'border-amber-500/30',
    },
    stable: {
      ribbon: 'status-ribbon-stable',
      border: 'border-emerald-500/30',
    },
    info: {
      ribbon: 'status-ribbon-info',
      border: 'border-sky-500/30',
    },
  };

  const config = status ? statusConfig[status] : null;

  const handleKeyDown = (e) => {
    if (onClick && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <article
      className={cn(
        'group relative rounded-xl sm:rounded-2xl p-4 sm:p-6',
        'bg-card border',
        config ? config.border : 'border-border',
        'hover:border-primary/30 hover:shadow-lg hover:shadow-primary/10',
        'transition-all duration-200',
        onClick && 'cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'animate-chronicle-enter',
        className
      )}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      tabIndex={onClick ? 0 : undefined}
      role={onClick ? "button" : undefined}
      aria-label={onClick ? title : undefined}
    >
      {/* Status ribbon */}
      {status && (
        <div className={cn('absolute top-0 right-0 w-2 h-full rounded-r-xl sm:rounded-r-2xl', config.ribbon)} />
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          {Icon && (
            <div className="shrink-0 mt-1">
              <Icon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h3 className="font-display text-lg sm:text-2xl text-foreground truncate mb-1">
              {title}
            </h3>
            {subtitle && (
              <p className="font-mono text-[10px] sm:text-xs text-muted-foreground uppercase">
                {subtitle}
              </p>
            )}
          </div>
        </div>

        {/* Badges */}
        {badges.length > 0 && (
          <div className="flex flex-col sm:flex-row gap-1 sm:gap-2 items-end sm:items-start shrink-0">
            {badges.map((badge, index) => (
              <Badge
                key={index}
                className={cn(
                  `badge-chronicle-${badge.color || 'amber'}`,
                  'text-[10px] sm:text-xs uppercase'
                )}
              >
                {badge.text}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Description */}
      {description && (
        <p className="text-xs sm:text-sm text-muted-foreground mb-3">
          {description}
        </p>
      )}

      {/* Metadata grid */}
      {metadata.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-6 mb-4">
          {metadata.map((item, index) => (
            <div key={index} className="space-y-1">
              <div className="flex items-center gap-1.5">
                {item.icon && <item.icon className="h-3 w-3 text-muted-foreground" aria-hidden="true" />}
                <span className="font-mono text-[9px] sm:text-[10px] text-muted-foreground uppercase tracking-wide">
                  {item.label}
                </span>
              </div>
              <div className="font-mono text-xs sm:text-sm text-foreground">
                {item.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      {actions.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-2 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
          {actions.map((action, index) => (
            <Button
              key={index}
              variant={action.variant || 'outline'}
              size="sm"
              className={cn('flex-1 sm:flex-none', action.className)}
              onClick={(e) => {
                e.stopPropagation();
                action.onClick?.();
              }}
            >
              {action.label}
            </Button>
          ))}
        </div>
      )}

      {/* Click indicator */}
      {onClick && (
        <ChevronRight className="absolute right-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity hidden sm:block" aria-hidden="true" />
      )}
    </article>
  );
}
