import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import Info from 'lucide-react/dist/esm/icons/info.js';
import React from 'react';

import { cn } from '@/lib/utils';

/**
 * UrgentBanner - Displays urgent alerts at the top of dashboards
 *
 * @param {Object} props
 * @param {Array} props.items - Array of urgent items to display
 * @param {string} props.severity - 'critical', 'warning', or 'info' (default: 'critical')
 * @param {Function} props.onItemClick - Callback when an item is clicked
 * @param {string} props.title - Banner title (default: 'Urgent Items')
 * @param {ReactNode} props.actions - Optional action buttons
 */
export default function UrgentBanner({
  items = [],
  severity = 'critical',
  onItemClick,
  title = 'Urgent Items',
  actions,
}) {
  if (!items || items.length === 0) {
    return null;
  }

  const severityConfig = {
    critical: {
      icon: AlertTriangle,
      bgClass: 'bg-rose-500/10 border-rose-500/30',
      textClass: 'text-rose-400',
      badgeClass: 'badge-chronicle-rose',
      glowClass: 'shadow-rose-500/20',
    },
    warning: {
      icon: AlertCircle,
      bgClass: 'bg-amber-500/10 border-amber-500/30',
      textClass: 'text-amber-400',
      badgeClass: 'badge-chronicle-amber',
      glowClass: 'shadow-amber-500/20',
    },
    info: {
      icon: Info,
      bgClass: 'bg-sky-500/10 border-sky-500/30',
      textClass: 'text-sky-400',
      badgeClass: 'badge-chronicle-sky',
      glowClass: 'shadow-sky-500/20',
    },
  };

  const config = severityConfig[severity];
  const Icon = config.icon;

  return (
    <div
      className={cn(
        'rounded-xl sm:rounded-2xl border p-4 sm:p-6 mb-4 sm:mb-6 shadow-lg',
        config.bgClass,
        config.glowClass,
        'animate-chronicle-enter'
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Icon className={cn('h-5 w-5 sm:h-6 sm:w-6', config.textClass)} />
          <div>
            <h2 className={cn('font-heading text-base sm:text-lg font-semibold', config.textClass)}>
              {title}
            </h2>
            <p className="text-xs sm:text-sm text-muted-foreground font-mono">
              {items.length} {items.length === 1 ? 'item' : 'items'} requiring attention
            </p>
          </div>
        </div>
        {actions && (
          <div className="flex gap-2">
            {actions}
          </div>
        )}
      </div>

      {/* Items list */}
      <div className="space-y-2">
        {items.map((item, index) => (
          <div
            key={item.id || index}
            className={cn(
              'flex items-center justify-between p-3 rounded-lg bg-card/50 border border-border',
              'hover:bg-card/80 transition-colors',
              onItemClick && 'cursor-pointer'
            )}
            onClick={() => onItemClick?.(item)}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                {item.label && (
                  <span className={cn('text-[10px] sm:text-xs uppercase font-mono', config.badgeClass)}>
                    {item.label}
                  </span>
                )}
                {item.patient_name && (
                  <span className="font-display text-sm sm:text-base truncate">
                    {item.patient_name}
                  </span>
                )}
              </div>
              <p className="text-xs sm:text-sm text-muted-foreground truncate">
                {item.description || item.message}
              </p>
              {item.time && (
                <span className="font-mono text-[10px] sm:text-xs text-muted-foreground">
                  {item.time}
                </span>
              )}
            </div>
            {item.badge && (
              <span className={cn('ml-3 shrink-0', config.badgeClass, 'text-[10px] sm:text-xs px-2 py-1')}>
                {item.badge}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
