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
import Package from 'lucide-react/dist/esm/icons/package.js';
import MoreHorizontal from 'lucide-react/dist/esm/icons/more-horizontal.js';
import Eye from 'lucide-react/dist/esm/icons/eye.js';
import Check from 'lucide-react/dist/esm/icons/check.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import ClipboardCheck from 'lucide-react/dist/esm/icons/clipboard-check.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import User from 'lucide-react/dist/esm/icons/user.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js';
import Building2 from 'lucide-react/dist/esm/icons/building-2.js';

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
  pending_inspection: {
    label: 'Pending Inspection',
    variant: 'outline',
    bgColor: 'bg-amber-500/10',
    textColor: 'text-amber-500',
    borderColor: 'border-amber-500/30',
  },
  inspecting: {
    label: 'Inspecting',
    variant: 'default',
    bgColor: 'bg-sky-500/10',
    textColor: 'text-sky-500',
    borderColor: 'border-sky-500/30',
  },
  accepted: {
    label: 'Accepted',
    variant: 'default',
    bgColor: 'bg-emerald-500/10',
    textColor: 'text-emerald-500',
    borderColor: 'border-emerald-500/30',
  },
  partially_accepted: {
    label: 'Partially Accepted',
    variant: 'default',
    bgColor: 'bg-amber-500/10',
    textColor: 'text-amber-500',
    borderColor: 'border-amber-500/30',
  },
  rejected: {
    label: 'Rejected',
    variant: 'destructive',
    bgColor: 'bg-rose-500/10',
    textColor: 'text-rose-500',
    borderColor: 'border-rose-500/30',
  },
};

/**
 * Get status config
 */
function getStatusConfig(status) {
  return STATUS_CONFIG[status?.toLowerCase()] || STATUS_CONFIG.draft;
}

/**
 * Format currency
 */
function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount || 0);
}

/**
 * GRNCard - Card display for goods received notes
 * @param {Object} props
 * @param {Object} props.grn - GRN object
 * @param {number} [props.index=0] - Index for animation delay
 * @param {Function} [props.onClick] - Click handler
 * @param {Function} [props.onInspect] - Inspect callback
 * @param {Function} [props.onAccept] - Accept callback
 * @param {Function} [props.onReject] - Reject callback
 * @param {string} [props.className] - Additional CSS classes
 */
export function GRNCard({
  grn,
  index = 0,
  onClick,
  onInspect,
  onAccept,
  onReject,
  className,
}) {
  const statusConfig = getStatusConfig(grn.status);

  const canInspect = grn.status === 'pending_inspection';
  const canAccept = grn.status === 'inspecting' || grn.status === 'pending_inspection';
  const canReject = grn.status === 'inspecting' || grn.status === 'pending_inspection';

  const hasQualityIssues = grn.quality_issues_count > 0 || grn.has_issues;

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
          {/* GRN number */}
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-muted-foreground" />
            <span className="font-mono text-sm font-medium text-primary">
              {grn.grn_number || grn.number}
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
              {canInspect && onInspect && (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onInspect(); }}>
                  <ClipboardCheck className="h-4 w-4 mr-2" />
                  Start Inspection
                </DropdownMenuItem>
              )}
              {canAccept && onAccept && (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onAccept(); }}>
                  <Check className="h-4 w-4 mr-2" />
                  Accept
                </DropdownMenuItem>
              )}
              {canReject && onReject && (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onReject(); }}>
                  <X className="h-4 w-4 mr-2" />
                  Reject
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Status and issues */}
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
          {hasQualityIssues && (
            <Badge variant="outline" className="text-xs bg-rose-500/10 text-rose-500 border-rose-500/30">
              <AlertTriangle className="h-3 w-3 mr-1" />
              Issues
            </Badge>
          )}
        </div>

        {/* PO Reference */}
        {grn.po_number && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
            <FileText className="h-3 w-3" />
            <span>PO: <span className="font-mono">{grn.po_number}</span></span>
          </div>
        )}

        {/* Supplier */}
        {grn.supplier_name && (
          <h3 className="text-sm text-foreground mb-2 truncate">
            {grn.supplier_name}
          </h3>
        )}

        {/* Dates */}
        <div className="space-y-1 mb-3">
          {grn.received_date && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Calendar className="h-3 w-3" />
              <span>
                Received{' '}
                <span className="font-mono">
                  {format(parseISO(grn.received_date), 'MMM d, yyyy')}
                </span>
              </span>
            </div>
          )}
          {grn.inspected_by_name && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <User className="h-3 w-3" />
              <span>Inspector: {grn.inspected_by_name}</span>
            </div>
          )}
        </div>

        {/* Footer stats */}
        <div className="flex items-center justify-between pt-3 border-t border-border">
          <div className="text-xs text-muted-foreground">
            {grn.items_count || grn.item_count || 0} item{(grn.items_count || grn.item_count || 0) !== 1 ? 's' : ''}
          </div>
          <div className="text-xs text-muted-foreground">
            {grn.accepted_count || 0} accepted
          </div>
        </div>

        {/* Acceptance progress */}
        {grn.items_count > 0 && (
          <div className="mt-3 pt-3 border-t border-border">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-muted-foreground">Inspected</span>
              <span className="font-mono">
                {(grn.accepted_count || 0) + (grn.rejected_count || 0)} / {grn.items_count}
              </span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden flex">
              <div
                className="h-full bg-emerald-500 transition-all duration-300"
                style={{ width: `${((grn.accepted_count || 0) / grn.items_count) * 100}%` }}
              />
              <div
                className="h-full bg-rose-500 transition-all duration-300"
                style={{ width: `${((grn.rejected_count || 0) / grn.items_count) * 100}%` }}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * GRNCardSkeleton - Loading state
 */
export function GRNCardSkeleton() {
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
          <Skeleton className="h-5 w-32" />
        </div>
        <Skeleton className="h-4 w-1/2 mb-2" />
        <Skeleton className="h-4 w-3/4 mb-2" />
        <div className="space-y-1 mb-3">
          <Skeleton className="h-4 w-2/3" />
        </div>
        <div className="flex items-center justify-between pt-3 border-t border-border">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-20" />
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * GRNRow - Table row display
 */
export function GRNRow({
  grn,
  index = 0,
  onClick,
  onInspect,
  onAccept,
  onReject,
}) {
  const statusConfig = getStatusConfig(grn.status);

  const canInspect = grn.status === 'pending_inspection';
  const canAccept = grn.status === 'inspecting' || grn.status === 'pending_inspection';
  const canReject = grn.status === 'inspecting' || grn.status === 'pending_inspection';

  const hasQualityIssues = grn.quality_issues_count > 0 || grn.has_issues;

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
          <Package className="h-4 w-4 text-muted-foreground" />
          <span className="font-mono text-sm font-medium text-primary">
            {grn.grn_number || grn.number}
          </span>
          {hasQualityIssues && (
            <AlertTriangle className="h-4 w-4 text-rose-500" />
          )}
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
        {grn.po_number ? (
          <span className="text-sm font-mono text-muted-foreground">
            {grn.po_number}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">-</span>
        )}
      </td>
      <td className="px-4 py-3 hidden lg:table-cell">
        <span className="text-sm truncate max-w-[150px] block">
          {grn.supplier_name || '-'}
        </span>
      </td>
      <td className="px-4 py-3 hidden md:table-cell">
        {grn.received_date ? (
          <span className="text-sm font-mono">
            {format(parseISO(grn.received_date), 'MMM d, yyyy')}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">-</span>
        )}
      </td>
      <td className="px-4 py-3 text-center">
        <span className="text-sm font-mono">
          {grn.items_count || grn.item_count || 0}
        </span>
      </td>
      <td className="px-4 py-3 text-center">
        <span className="text-sm font-mono text-emerald-500">
          {grn.accepted_count || 0}
        </span>
        {grn.rejected_count > 0 && (
          <span className="text-sm font-mono text-rose-500 ml-1">
            / {grn.rejected_count}
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
            {canInspect && onInspect && (
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onInspect(); }}>
                <ClipboardCheck className="h-4 w-4 mr-2" />
                Start Inspection
              </DropdownMenuItem>
            )}
            {canAccept && onAccept && (
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onAccept(); }}>
                <Check className="h-4 w-4 mr-2" />
                Accept
              </DropdownMenuItem>
            )}
            {canReject && onReject && (
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onReject(); }}>
                <X className="h-4 w-4 mr-2" />
                Reject
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}

/**
 * GRNRowSkeleton - Loading state for row
 */
export function GRNRowSkeleton() {
  return (
    <tr>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-4" />
          <Skeleton className="h-4 w-24" />
        </div>
      </td>
      <td className="px-4 py-3">
        <Skeleton className="h-5 w-28" />
      </td>
      <td className="px-4 py-3 hidden md:table-cell">
        <Skeleton className="h-4 w-20" />
      </td>
      <td className="px-4 py-3 hidden lg:table-cell">
        <Skeleton className="h-4 w-32" />
      </td>
      <td className="px-4 py-3 hidden md:table-cell">
        <Skeleton className="h-4 w-24" />
      </td>
      <td className="px-4 py-3 text-center">
        <Skeleton className="h-4 w-8 mx-auto" />
      </td>
      <td className="px-4 py-3 text-center">
        <Skeleton className="h-4 w-12 mx-auto" />
      </td>
      <td className="px-4 py-3">
        <Skeleton className="h-8 w-8" />
      </td>
    </tr>
  );
}
