import React from 'react';
import { cn } from '@/lib/utils';

/**
 * Visit status to display configuration mapping
 */
const STATUS_CONFIG = {
  checked_in: {
    label: 'Checked In',
    color: 'sky',
    bgClass: 'bg-sky-500/10',
    textClass: 'text-sky-400',
    borderClass: 'border-sky-500/30',
  },
  waiting: {
    label: 'Waiting',
    color: 'amber',
    bgClass: 'bg-amber-500/10',
    textClass: 'text-amber-400',
    borderClass: 'border-amber-500/30',
  },
  called: {
    label: 'Called',
    color: 'amber',
    bgClass: 'bg-amber-500/10',
    textClass: 'text-amber-400',
    borderClass: 'border-amber-500/30',
    pulse: true,
  },
  in_progress: {
    label: 'With Doctor',
    color: 'emerald',
    bgClass: 'bg-emerald-500/10',
    textClass: 'text-emerald-400',
    borderClass: 'border-emerald-500/30',
  },
  on_hold: {
    label: 'On Hold',
    color: 'rose',
    bgClass: 'bg-rose-500/10',
    textClass: 'text-rose-400',
    borderClass: 'border-rose-500/30',
  },
  ready_checkout: {
    label: 'Ready for Checkout',
    color: 'sky',
    bgClass: 'bg-sky-500/10',
    textClass: 'text-sky-400',
    borderClass: 'border-sky-500/30',
  },
  checked_out: {
    label: 'Checked Out',
    color: 'muted',
    bgClass: 'bg-muted/50',
    textClass: 'text-muted-foreground',
    borderClass: 'border-border',
  },
  no_show: {
    label: 'No Show',
    color: 'rose',
    bgClass: 'bg-rose-500/10',
    textClass: 'text-rose-400',
    borderClass: 'border-rose-500/30',
  },
  cancelled: {
    label: 'Cancelled',
    color: 'muted',
    bgClass: 'bg-muted/50',
    textClass: 'text-muted-foreground',
    borderClass: 'border-border',
  },
};

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
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.checked_in;

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

/**
 * Get the color name for a visit status
 * Useful for other components that need to match colors
 */
export function getVisitStatusColor(status) {
  return STATUS_CONFIG[status]?.color || 'muted';
}

/**
 * Get the display label for a visit status
 */
export function getVisitStatusLabel(status) {
  return STATUS_CONFIG[status]?.label || status;
}

export default VisitStatusBadge;
