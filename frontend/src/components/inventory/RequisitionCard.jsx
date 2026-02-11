import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { format, parseISO } from 'date-fns';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import MoreHorizontal from 'lucide-react/dist/esm/icons/more-horizontal.js';
import Eye from 'lucide-react/dist/esm/icons/eye.js';
import Check from 'lucide-react/dist/esm/icons/check.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import User from 'lucide-react/dist/esm/icons/user.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';

/**
 * Status configuration
 */
const STATUS_CONFIG = {
  draft: {
    label: 'Draft',
    variant: 'secondary',
    bgColor: 'bg-muted',
    textColor: 'text-muted-foreground',
  },
  pending: {
    label: 'Pending Approval',
    variant: 'outline',
    bgColor: 'bg-amber-500/10',
    textColor: 'text-amber-500',
    borderColor: 'border-amber-500/30',
  },
  approved: {
    label: 'Approved',
    variant: 'default',
    bgColor: 'bg-emerald-500/10',
    textColor: 'text-emerald-500',
    borderColor: 'border-emerald-500/30',
  },
  rejected: {
    label: 'Rejected',
    variant: 'destructive',
    bgColor: 'bg-rose-500/10',
    textColor: 'text-rose-500',
    borderColor: 'border-rose-500/30',
  },
  converted: {
    label: 'Converted to PO',
    variant: 'default',
    bgColor: 'bg-sky-500/10',
    textColor: 'text-sky-500',
    borderColor: 'border-sky-500/30',
  },
  cancelled: {
    label: 'Cancelled',
    variant: 'secondary',
    bgColor: 'bg-muted',
    textColor: 'text-muted-foreground',
  },
};

/**
 * Priority configuration
 */
const PRIORITY_CONFIG = {
  low: {
    label: 'Low',
    color: 'text-muted-foreground',
  },
  normal: {
    label: 'Normal',
    color: 'text-sky-500',
  },
  high: {
    label: 'High',
    color: 'text-amber-500',
  },
  urgent: {
    label: 'Urgent',
    color: 'text-rose-500',
  },
};

/**
 * Get status config
 */
export function getStatusConfig(status) {
  return STATUS_CONFIG[status?.toLowerCase()] || STATUS_CONFIG.draft;
}

/**
 * Get priority config
 */
export function getPriorityConfig(priority) {
  return PRIORITY_CONFIG[priority?.toLowerCase()] || PRIORITY_CONFIG.normal;
}

/**
 * Format currency
 */
export function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount || 0);
}

/**
 * RequisitionCard - Card display for purchase requisitions
 * @param {Object} props
 * @param {Object} props.requisition - Requisition object
 * @param {number} [props.index=0] - Index for animation delay
 * @param {Function} [props.onClick] - Click handler
 * @param {Function} [props.onApprove] - Approve callback
 * @param {Function} [props.onReject] - Reject callback
 * @param {Function} [props.onConvert] - Convert to PO callback
 * @param {string} [props.className] - Additional CSS classes
 */
export function RequisitionCard({
  requisition,
  index = 0,
  onClick,
  onApprove,
  onReject,
  onConvert,
  className,
}) {
  const statusConfig = getStatusConfig(requisition.status);
  const priorityConfig = getPriorityConfig(requisition.priority);

  const canApprove = requisition.status === 'pending';
  const canReject = requisition.status === 'pending';
  const canConvert = requisition.status === 'approved';

  return (
    <Card
      className={cn(
        'group relative bg-card/30 border-border/50',
        'hover:border-primary/30 hover:shadow-[0_0_20px_-8px_var(--chronicle-amber)]',
        'transition-all duration-300 cursor-pointer',
        'animate-chronicle-enter',
        className
      )}
      style={{ animationDelay: `${index * 50}ms` }}
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          {/* Requisition number and status */}
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-muted-foreground" />
            <span className="font-mono text-sm font-medium text-primary">
              {requisition.requisition_number || requisition.number}
            </span>
          </div>

          {/* Actions */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onClick?.(); }}>
                <Eye className="h-4 w-4 mr-2" />
                View Details
              </DropdownMenuItem>
              {canApprove && onApprove && (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onApprove(); }}>
                  <Check className="h-4 w-4 mr-2" />
                  Approve
                </DropdownMenuItem>
              )}
              {canReject && onReject && (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onReject(); }}>
                  <X className="h-4 w-4 mr-2" />
                  Reject
                </DropdownMenuItem>
              )}
              {canConvert && onConvert && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onConvert(); }}>
                    <FileText className="h-4 w-4 mr-2" />
                    Convert to PO
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Status and Priority */}
        <div className="flex items-center gap-2 mb-3">
          <Badge
            variant="outline"
            className={cn(
              'text-xs',
              statusConfig.bgColor,
              statusConfig.textColor,
              statusConfig.borderColor
            )}
          >
            {statusConfig.label}
          </Badge>
          {requisition.priority && requisition.priority !== 'normal' && (
            <span className={cn('text-xs font-medium', priorityConfig.color)}>
              <AlertTriangle className="h-3 w-3 inline mr-1" />
              {priorityConfig.label}
            </span>
          )}
        </div>

        {/* Requester and dates */}
        <div className="space-y-2 mb-3">
          {requisition.requested_by_name && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <User className="h-3 w-3" />
              <span>Requested by {requisition.requested_by_name}</span>
            </div>
          )}
          {requisition.date_required && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Calendar className="h-3 w-3" />
              <span>
                Required by{' '}
                <span className="font-mono">
                  {format(parseISO(requisition.date_required), 'MMM d, yyyy')}
                </span>
              </span>
            </div>
          )}
          {requisition.created_at && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span className="font-mono">
                {format(parseISO(requisition.created_at), 'MMM d, yyyy')}
              </span>
            </div>
          )}
        </div>

        {/* Footer stats */}
        <div className="flex items-center justify-between pt-3 border-t border-border">
          <div className="text-xs text-muted-foreground">
            {requisition.items_count || requisition.item_count || 0} item{(requisition.items_count || requisition.item_count || 0) !== 1 ? 's' : ''}
          </div>
          <div className="font-mono text-sm font-semibold">
            {formatCurrency(requisition.total_amount || requisition.total)}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * RequisitionCardSkeleton - Loading state
 */
export function RequisitionCardSkeleton() {
  return (
    <Card className="bg-card/30 border-border/50">
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-4" />
            <Skeleton className="h-4 w-24" />
          </div>
          <Skeleton className="h-8 w-8" />
        </div>
        <div className="flex items-center gap-2 mb-3">
          <Skeleton className="h-5 w-28" />
        </div>
        <div className="space-y-2 mb-3">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
        <div className="flex items-center justify-between pt-3 border-t border-border">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-5 w-20" />
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * RequisitionRow - Table row display
 */
export function RequisitionRow({
  requisition,
  index = 0,
  onClick,
  onApprove,
  onReject,
  onConvert,
}) {
  const statusConfig = getStatusConfig(requisition.status);
  const priorityConfig = getPriorityConfig(requisition.priority);

  const canApprove = requisition.status === 'pending';
  const canReject = requisition.status === 'pending';
  const canConvert = requisition.status === 'approved';

  return (
    <tr
      className={cn(
        'group hover:bg-muted/30 transition-colors cursor-pointer',
        'animate-chronicle-enter'
      )}
      style={{ animationDelay: `${index * 30}ms` }}
      onClick={onClick}
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-muted-foreground" />
          <span className="font-mono text-sm font-medium text-primary">
            {requisition.requisition_number || requisition.number}
          </span>
        </div>
      </td>
      <td className="px-4 py-3">
        <Badge
          variant="outline"
          className={cn(
            'text-xs',
            statusConfig.bgColor,
            statusConfig.textColor,
            statusConfig.borderColor
          )}
        >
          {statusConfig.label}
        </Badge>
      </td>
      <td className="px-4 py-3 hidden md:table-cell">
        <span className="text-sm text-muted-foreground">
          {requisition.requested_by_name || '-'}
        </span>
      </td>
      <td className="px-4 py-3 hidden lg:table-cell">
        {requisition.date_required ? (
          <span className="text-sm font-mono">
            {format(parseISO(requisition.date_required), 'MMM d, yyyy')}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">-</span>
        )}
      </td>
      <td className="px-4 py-3 text-center">
        <span className="text-sm font-mono">
          {requisition.items_count || requisition.item_count || 0}
        </span>
      </td>
      <td className="px-4 py-3 text-right">
        <span className="font-mono text-sm font-semibold">
          {formatCurrency(requisition.total_amount || requisition.total)}
        </span>
      </td>
      <td className="px-4 py-3 hidden sm:table-cell">
        {requisition.priority && requisition.priority !== 'normal' && (
          <span className={cn('text-xs font-medium', priorityConfig.color)}>
            {priorityConfig.label}
          </span>
        )}
      </td>
      <td className="px-4 py-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onClick?.(); }}>
              <Eye className="h-4 w-4 mr-2" />
              View Details
            </DropdownMenuItem>
            {canApprove && onApprove && (
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onApprove(); }}>
                <Check className="h-4 w-4 mr-2" />
                Approve
              </DropdownMenuItem>
            )}
            {canReject && onReject && (
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onReject(); }}>
                <X className="h-4 w-4 mr-2" />
                Reject
              </DropdownMenuItem>
            )}
            {canConvert && onConvert && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onConvert(); }}>
                  <FileText className="h-4 w-4 mr-2" />
                  Convert to PO
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}

/**
 * RequisitionRowSkeleton - Loading state for row
 */
export function RequisitionRowSkeleton() {
  return (
    <tr>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-4 w-24" />
        </div>
      </td>
      <td className="px-4 py-3">
        <Skeleton className="h-5 w-24" />
      </td>
      <td className="px-4 py-3 hidden md:table-cell">
        <Skeleton className="h-4 w-28" />
      </td>
      <td className="px-4 py-3 hidden lg:table-cell">
        <Skeleton className="h-4 w-24" />
      </td>
      <td className="px-4 py-3 text-center">
        <Skeleton className="h-4 w-8 mx-auto" />
      </td>
      <td className="px-4 py-3 text-right">
        <Skeleton className="h-4 w-20 ml-auto" />
      </td>
      <td className="px-4 py-3 hidden sm:table-cell">
        <Skeleton className="h-4 w-12" />
      </td>
      <td className="px-4 py-3">
        <Skeleton className="h-8 w-8" />
      </td>
    </tr>
  );
}
