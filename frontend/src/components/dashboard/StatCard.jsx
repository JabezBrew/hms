import TrendingUp from 'lucide-react/dist/esm/icons/trending-up.js';
import TrendingDown from 'lucide-react/dist/esm/icons/trending-down.js';
import Minus from 'lucide-react/dist/esm/icons/minus.js';
import React from 'react';

import { cn } from '@/lib/utils';

/**
 * StatCard - Display statistics with Chronicle styling
 *
 * @param {Object} props
 * @param {string} props.title - Stat title
 * @param {string|number} props.value - Main stat value
 * @param {string} props.subtitle - Optional subtitle/description
 * @param {ReactNode} props.icon - Optional icon
 * @param {Object} props.trend - Optional trend data { value, direction: 'up'|'down'|'neutral' }
 * @param {string} props.color - Color accent: 'amber', 'emerald', 'rose', 'sky' (default: 'amber')
 * @param {Function} props.onClick - Optional click handler
 * @param {string} props.className - Additional CSS classes
 */
export default function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  color = 'amber',
  onClick,
  className,
}) {
  const colorConfig = {
    amber: {
      accent: 'text-primary',
      border: 'border-primary/20',
      bg: 'bg-primary/5',
    },
    emerald: {
      accent: 'text-emerald-400',
      border: 'border-emerald-500/20',
      bg: 'bg-emerald-500/5',
    },
    rose: {
      accent: 'text-rose-400',
      border: 'border-rose-500/20',
      bg: 'bg-rose-500/5',
    },
    sky: {
      accent: 'text-sky-400',
      border: 'border-sky-500/20',
      bg: 'bg-sky-500/5',
    },
  };

  const config = colorConfig[color];

  const TrendIcon = trend?.direction === 'up' ? TrendingUp
    : trend?.direction === 'down' ? TrendingDown
    : Minus;

  const trendColor = trend?.direction === 'up' ? 'text-emerald-400'
    : trend?.direction === 'down' ? 'text-rose-400'
    : 'text-muted-foreground';

  return (
    <article
      className={cn(
        'group relative rounded-xl sm:rounded-2xl p-4 sm:p-6',
        'bg-card border border-border',
        'hover:border-primary/30 transition-all duration-200',
        onClick && 'cursor-pointer hover:shadow-lg hover:shadow-primary/10',
        'animate-chronicle-enter',
        className
      )}
      onClick={onClick}
    >
      {/* Top row - Icon and trend */}
      <div className="flex items-start justify-between mb-3">
        {Icon && (
          <div className={cn(
            'p-2 sm:p-3 rounded-lg',
            config.bg,
            config.border,
            'border'
          )}>
            <Icon className={cn('h-4 w-4 sm:h-5 sm:w-5', config.accent)} />
          </div>
        )}
        {trend && (
          <div className="flex items-center gap-1 text-xs font-mono">
            <TrendIcon className={cn('h-3 w-3', trendColor)} />
            <span className={trendColor}>{trend.value}</span>
          </div>
        )}
      </div>

      {/* Value */}
      <div className="mb-2">
        <div className="font-display text-3xl sm:text-4xl font-semibold text-foreground">
          {value}
        </div>
      </div>

      {/* Title */}
      <div className="space-y-1">
        <h3 className="font-heading text-sm sm:text-base font-medium text-foreground">
          {title}
        </h3>
        {subtitle && (
          <p className="text-xs sm:text-sm text-muted-foreground">
            {subtitle}
          </p>
        )}
      </div>

      {/* Hover indicator */}
      {onClick && (
        <div className="absolute inset-0 rounded-xl sm:rounded-2xl border-2 border-primary/0 group-hover:border-primary/50 transition-colors pointer-events-none" />
      )}
    </article>
  );
}
