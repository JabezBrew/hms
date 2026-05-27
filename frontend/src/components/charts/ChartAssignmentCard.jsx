/**
 * ChartAssignmentCard - Chronicle-styled card for active chart monitoring
 *
 * Shows chart assignment status, last entry, next due time,
 * and quick action to record new entry.
 */

import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/triangle-alert.js';
import CheckCircle2 from 'lucide-react/dist/esm/icons/circle-check.js';
import PauseCircle from 'lucide-react/dist/esm/icons/circle-pause.js';
import PlayCircle from 'lucide-react/dist/esm/icons/circle-play.js';
import Ban from 'lucide-react/dist/esm/icons/ban.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

import formatDistanceToNow from "date-fns/formatDistanceToNow";
import isPast from "date-fns/isPast";

// Status configuration
const STATUS_CONFIG = {
  active: {
    label: 'Active',
    icon: PlayCircle,
    color: 'emerald',
    bgClass: 'bg-emerald-100 dark:bg-emerald-900/30',
    textClass: 'text-emerald-600 dark:text-emerald-400',
  },
  paused: {
    label: 'Paused',
    icon: PauseCircle,
    color: 'amber',
    bgClass: 'bg-amber-100 dark:bg-amber-900/30',
    textClass: 'text-amber-600 dark:text-amber-400',
  },
  completed: {
    label: 'Completed',
    icon: CheckCircle2,
    color: 'sky',
    bgClass: 'bg-sky-100 dark:bg-sky-900/30',
    textClass: 'text-sky-600 dark:text-sky-400',
  },
  discontinued: {
    label: 'Discontinued',
    icon: Ban,
    color: 'rose',
    bgClass: 'bg-rose-100 dark:bg-rose-900/30',
    textClass: 'text-rose-600 dark:text-rose-400',
  },
};

const ChartAssignmentCard = ({
  assignment,
  index = 0,
  onRecordEntry,
  onViewDetails,
  compact = false,
}) => {
  const statusConfig = STATUS_CONFIG[assignment.status] || STATUS_CONFIG.active;
  const StatusIcon = statusConfig.icon;

  // Check if entry is overdue
  const nextDue = assignment.next_due_at ? new Date(assignment.next_due_at) : null;
  const isOverdue = nextDue && isPast(nextDue) && assignment.status === 'active';

  // Format last entry time
  const lastEntryTime = assignment.last_entry_at
    ? formatDistanceToNow(new Date(assignment.last_entry_at), { addSuffix: true })
    : 'Never';

  // Format next due time
  const nextDueTime = nextDue
    ? formatDistanceToNow(nextDue, { addSuffix: true })
    : null;

  const handleViewDetails = () => {
    onViewDetails?.(assignment);
  };

  if (compact) {
    return (
      <div
        className={cn(
          "group relative flex items-center gap-3 p-3 rounded-lg border border-border",
          "hover:border-primary/30 transition-all",
          "animate-chronicle-enter",
          isOverdue && "border-rose-300 dark:border-rose-800",
          `stagger-${Math.min(index + 1, 10)}`
        )}
      >
        <button
          type="button"
          className="absolute inset-0 z-0 rounded-lg cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          onClick={handleViewDetails}
          aria-label={`View chart assignment ${assignment.template_name}`}
        />

        {/* Icon */}
        <div className={cn("relative z-10 pointer-events-none p-1.5 rounded-lg", statusConfig.bgClass)}>
          <ClipboardList className={cn("size-4", statusConfig.textClass)} />
        </div>

        {/* Info */}
        <div className="relative z-10 pointer-events-none flex-1 min-w-0">
          <p className="font-mono text-sm font-medium truncate">
            {assignment.template_name}
          </p>
          <p className="font-mono text-[10px] text-muted-foreground">
            Last: {lastEntryTime}
          </p>
        </div>

        {/* Status/Due indicator */}
        {assignment.status === 'active' && nextDue && (
          <div className={cn(
            "relative z-10 pointer-events-none flex items-center gap-1 text-[10px] font-mono",
            isOverdue ? "text-rose-500" : "text-muted-foreground"
          )}>
            {isOverdue && <AlertTriangle className="size-3" />}
            <Clock className="size-3" />
            <span>{nextDueTime}</span>
          </div>
        )}

        {/* Quick action */}
        {assignment.status === 'active' && (
          <Button
            type="button"
            size="sm"
            variant={isOverdue ? "default" : "outline"}
            className={cn(
              "relative z-20 h-7 px-2 font-mono text-[10px] opacity-0 group-hover:opacity-100 transition-opacity",
              isOverdue && "bg-rose-500 hover:bg-rose-600"
            )}
            onClick={(e) => {
              e.stopPropagation();
              onRecordEntry?.(assignment);
            }}
          >
            Record
          </Button>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group relative bg-card border border-border rounded-xl overflow-hidden",
        "hover:border-primary/30 hover:shadow-md transition-all",
        "animate-chronicle-enter",
        isOverdue && "border-rose-300 dark:border-rose-800",
        `stagger-${Math.min(index + 1, 10)}`
      )}
    >
      <button
        type="button"
        className="absolute inset-0 z-0 rounded-xl cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        onClick={handleViewDetails}
        aria-label={`View chart assignment ${assignment.template_name}`}
      />

      {/* Overdue ribbon */}
      {isOverdue && (
        <div className="absolute top-0 left-0 right-0 h-1 bg-rose-500" />
      )}

      <div className="relative z-10 pointer-events-none p-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className={cn("p-2 rounded-lg", statusConfig.bgClass)}>
              <ClipboardList className={cn("size-5", statusConfig.textClass)} />
            </div>
            <div className="min-w-0">
              <h3 className="font-display text-base text-foreground truncate">
                {assignment.template_name}
              </h3>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={cn(
                  "flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded",
                  statusConfig.bgClass, statusConfig.textClass
                )}>
                  <StatusIcon className="size-3" />
                  {statusConfig.label}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  {assignment.effective_interval}
                </span>
              </div>
            </div>
          </div>

          <ChevronRight className="size-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div>
            <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
              Last Entry
            </p>
            <p className="font-mono text-xs text-foreground">
              {lastEntryTime}
            </p>
          </div>
          <div>
            <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
              Entries
            </p>
            <p className="font-mono text-xs text-foreground">
              {assignment.entry_count || 0}
            </p>
          </div>
          <div>
            <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
              Next Due
            </p>
            <p className={cn(
              "font-mono text-xs",
              isOverdue ? "text-rose-500 font-medium" : "text-foreground"
            )}>
              {assignment.status === 'active' && nextDue
                ? nextDueTime
                : '—'
              }
            </p>
          </div>
        </div>

        {/* Overdue warning */}
        {isOverdue && (
          <div className="flex items-center gap-2 p-2 rounded-lg bg-rose-50 dark:bg-rose-900/20 mb-3">
            <AlertTriangle className="size-4 text-rose-500" />
            <span className="font-mono text-xs text-rose-600 dark:text-rose-400">
              Entry overdue
            </span>
          </div>
        )}

        {/* Action */}
        {assignment.status === 'active' && (
          <Button
            type="button"
            className={cn(
              "relative z-20 pointer-events-auto w-full font-mono text-xs",
              isOverdue
                ? "bg-rose-500 hover:bg-rose-600"
                : "bg-amber-600 hover:bg-amber-700"
            )}
            onClick={(e) => {
              e.stopPropagation();
              onRecordEntry?.(assignment);
            }}
          >
            <ClipboardList className="size-3.5 mr-1.5" />
            Record Entry
          </Button>
        )}
      </div>
    </div>
  );
};

export { ChartAssignmentCard };
