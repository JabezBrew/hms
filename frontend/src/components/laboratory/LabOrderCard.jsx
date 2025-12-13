import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  TestTube2,
  Clock,
  User,
  Calendar,
  AlertTriangle,
  ChevronRight,
} from "lucide-react";
import { format } from "date-fns";

/**
 * LabOrderCard - Chronicle-styled card for displaying lab orders
 *
 * Features:
 * - Magazine-style card with warm stone colors
 * - Shows order number, patient, tests, status, priority
 * - Priority and status badges
 * - Critical result indicator
 * - Click to view details
 */
const LabOrderCard = ({
  order,
  index = 0,
  onClick,
  className,
}) => {
  // Status badge configuration
  const getStatusConfig = (status) => {
    const configs = {
      draft: { label: "Draft", className: "bg-stone-100 text-stone-700 border-stone-300" },
      ordered: { label: "Ordered", className: "bg-sky-100 text-sky-700 border-sky-300" },
      collected: { label: "Collected", className: "bg-amber-100 text-amber-700 border-amber-300" },
      received: { label: "Received", className: "bg-violet-100 text-violet-700 border-violet-300" },
      processing: { label: "Processing", className: "bg-indigo-100 text-indigo-700 border-indigo-300" },
      completed: { label: "Completed", className: "bg-emerald-100 text-emerald-700 border-emerald-300" },
      cancelled: { label: "Cancelled", className: "bg-rose-100 text-rose-700 border-rose-300" },
    };
    return configs[status] || configs.draft;
  };

  // Priority badge configuration
  const getPriorityConfig = (priority) => {
    const configs = {
      routine: { label: "Routine", className: "bg-stone-100 text-stone-600" },
      urgent: { label: "Urgent", className: "bg-amber-100 text-amber-700" },
      stat: { label: "STAT", className: "bg-rose-100 text-rose-700 font-semibold" },
    };
    return configs[priority] || configs.routine;
  };

  const statusConfig = getStatusConfig(order.status);
  const priorityConfig = getPriorityConfig(order.priority);

  // Format date
  const formatDate = (dateString) => {
    if (!dateString) return "-";
    try {
      return format(new Date(dateString), "MMM d, yyyy h:mm a");
    } catch {
      return "-";
    }
  };

  return (
    <div
      className={cn(
        "group relative bg-card/30 backdrop-blur-sm rounded-lg border border-border/50",
        "hover:bg-card/50 hover:border-border hover:shadow-md",
        "transition-all duration-300 cursor-pointer",
        "animate-chronicle-enter",
        className
      )}
      style={{ animationDelay: `${index * 50}ms` }}
      onClick={() => onClick?.(order)}
    >
      {/* Critical indicator stripe */}
      {order.has_critical_results && (
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-rose-500 rounded-l-lg" />
      )}

      <div className="p-4 sm:p-5">
        {/* Header row: Order number + Status */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <TestTube2 className="h-4 w-4 text-sky-500" />
            <span className="font-mono text-xs text-muted-foreground">
              {order.order_number}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Priority badge */}
            <Badge
              variant="outline"
              className={cn("text-[10px] px-1.5 py-0", priorityConfig.className)}
            >
              {priorityConfig.label}
            </Badge>

            {/* Status badge */}
            <Badge
              variant="outline"
              className={cn("text-[10px] px-1.5 py-0", statusConfig.className)}
            >
              {order.status_display || statusConfig.label}
            </Badge>
          </div>
        </div>

        {/* Patient info */}
        <div className="mb-3">
          <h3 className="font-display text-base sm:text-lg text-foreground leading-tight mb-0.5">
            {order.patient_name || "Unknown Patient"}
          </h3>
          <span className="font-mono text-[10px] text-muted-foreground">
            MRN: {order.patient_mrn || "-"}
          </span>
        </div>

        {/* Tests count and critical indicator */}
        <div className="flex items-center gap-3 mb-3 text-sm text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <TestTube2 className="h-3.5 w-3.5" />
            <span className="font-mono text-xs">
              {order.test_count || 0} test{order.test_count !== 1 ? "s" : ""}
            </span>
          </div>

          {order.has_critical_results && (
            <div className="flex items-center gap-1 text-rose-600">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span className="text-xs font-medium">Critical</span>
            </div>
          )}

          {order.fasting_required && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-amber-50 text-amber-700 border-amber-200">
              Fasting
            </Badge>
          )}
        </div>

        {/* Footer: Provider and date */}
        <div className="flex items-center justify-between pt-2 border-t border-border/30">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <User className="h-3 w-3" />
            <span className="truncate max-w-[120px]">
              {order.ordering_provider_name || "Unknown"}
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Calendar className="h-3 w-3" />
            <span className="font-mono text-[10px]">
              {formatDate(order.ordered_at || order.created_at)}
            </span>
          </div>
        </div>
      </div>

      {/* Hover chevron */}
      <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity">
        <ChevronRight className="h-5 w-5 text-muted-foreground" />
      </div>
    </div>
  );
};

export { LabOrderCard };
export default LabOrderCard;
