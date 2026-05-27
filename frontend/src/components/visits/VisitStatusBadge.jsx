import React from 'react';
import { cn } from '@/lib/utils';
import { getVisitStatusConfig } from './visit-status-utils';

/**
 * VisitStatusBadge - Displays outpatient visit status with Chronicle design colors
 *
 * @param {Object} props
 * @param {string} props.status - Visit status (checked_in, waiting, called, in_progress, etc.)
 * @param {string} props.size - Badge size ('sm' | 'md')
 * @param {boolean} props.showBorder - Show border around badge
 * @param {string} props.className - Additional CSS classes
 */
export function VisitStatusBadge({
  status,
  size = 'sm',
  showBorder = false,
  className,
}) {
  const config = getVisitStatusConfig(status);

  const sizeClasses = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-sm',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center rounded font-mono font-medium',
        config.bgClass,
        config.textClass,
        showBorder && `border ${config.borderClass}`,
        sizeClasses[size],
        config.pulse && 'animate-pulse',
        className
      )}
    >
      {config.label}
    </span>
  );
}

