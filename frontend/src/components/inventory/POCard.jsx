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
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import MoreHorizontal from 'lucide-react/dist/esm/icons/more-horizontal.js';
import Eye from 'lucide-react/dist/esm/icons/eye.js';
import Send from 'lucide-react/dist/esm/icons/send.js';
import Package from 'lucide-react/dist/esm/icons/package.js';
import Check from 'lucide-react/dist/esm/icons/check.js';
import Printer from 'lucide-react/dist/esm/icons/printer.js';
import Building2 from 'lucide-react/dist/esm/icons/building-2.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import Truck from 'lucide-react/dist/esm/icons/truck.js';

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
  sent: {
    label: 'Sent to Supplier',
    variant: 'default',
    bgColor: 'bg-sky-500/10',
    textColor: 'text-sky-500',
    borderColor: 'border-sky-500/30',
  },
  acknowledged: {
    label: 'Acknowledged',
    variant: 'default',
    bgColor: 'bg-sky-500/10',
    textColor: 'text-sky-500',
    borderColor: 'border-sky-500/30',
  },
  receiving: {
    label: 'Receiving',
    variant: 'default',
    bgColor: 'bg-violet-500/10',
    textColor: 'text-violet-500',
    borderColor: 'border-violet-500/30',
  },
  partially_received: {
    label: 'Partially Received',
    variant: 'default',
    bgColor: 'bg-amber-500/10',
    textColor: 'text-amber-500',
    borderColor: 'border-amber-500/30',
  },
  received: {
    label: 'Received',
    variant: 'default',
    bgColor: 'bg-emerald-500/10',
    textColor: 'text-emerald-500',
    borderColor: 'border-emerald-500/30',
  },
  closed: {
    label: 'Closed',
    variant: 'secondary',
    bgColor: 'bg-muted',
    textColor: 'text-muted-foreground',
  },
  cancelled: {
    label: 'Cancelled',
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
 * POCard - Card display for purchase orders
 * @param {Object} props
 * @param {Object} props.po - Purchase order object
 * @param {number} [props.index=0] - Index for animation delay
 * @param {Function} [props.onClick] - Click handler
 * @param {Function} [props.onSend] - Send to supplier callback
 * @param {Function} [props.onCreateGRN] - Create GRN callback
 * @param {Function} [props.onPrint] - Print callback
 * @param {string} [props.className] - Additional CSS classes
 */
export function POCard({
  po,
  index = 0,
  onClick,
  onSend,
  onCreateGRN,
  onPrint,
  className,
}) {
  const statusConfig = getStatusConfig(po.status);

  const canSend = po.status === 'approved';
  const canCreateGRN = ['sent', 'acknowledged', 'receiving', 'partially_received'].includes(po.status);

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
          {/* PO number */}
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <span className="font-mono text-sm font-medium text-primary">
              {po.po_number || po.number}
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
              {canSend && onSend && (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onSend(); }}>
                  <Send className="h-4 w-4 mr-2" />
                  Send to Supplier
                </DropdownMenuItem>
              )}
              {canCreateGRN && onCreateGRN && (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onCreateGRN(); }}>
                  <Package className="h-4 w-4 mr-2" />
                  Create GRN
                </DropdownMenuItem>
              )}
              {onPrint && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onPrint(); }}>
                    <Printer className="h-4 w-4 mr-2" />
                    Print
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Status */}
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
        </div>

        {/* Supplier */}
        <h3 className="font-display text-lg text-foreground mb-2 truncate">
          {po.supplier_name || po.supplier}
        </h3>

        {/* Dates */}
        <div className="space-y-2 mb-3">
          {po.order_date && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Calendar className="h-3 w-3" />
              <span>
                Ordered{' '}
                <span className="font-mono">
                  {format(parseISO(po.order_date), 'MMM d, yyyy')}
                </span>
              </span>
            </div>
          )}
          {po.expected_delivery_date && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Truck className="h-3 w-3" />
              <span>
                Expected{' '}
                <span className="font-mono">
                  {format(parseISO(po.expected_delivery_date), 'MMM d, yyyy')}
                </span>
              </span>
            </div>
          )}
        </div>

        {/* Footer stats */}
        <div className="flex items-center justify-between pt-3 border-t border-border">
          <div className="text-xs text-muted-foreground">
            {po.items_count || po.item_count || 0} item{(po.items_count || po.item_count || 0) !== 1 ? 's' : ''}
          </div>
          <div className="font-mono text-sm font-semibold text-emerald-500">
            {formatCurrency(po.total_amount || po.total)}
          </div>
        </div>

        {/* Received progress */}
        {po.received_count !== undefined && po.items_count > 0 && (
          <div className="mt-3 pt-3 border-t border-border">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-muted-foreground">Received</span>
              <span className="font-mono">
                {po.received_count} / {po.items_count}
              </span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all duration-300"
                style={{ width: `${(po.received_count / po.items_count) * 100}%` }}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * POCardSkeleton - Loading state
 */
export function POCardSkeleton() {
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
        <Skeleton className="h-6 w-3/4 mb-2" />
        <div className="space-y-2 mb-3">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
        </div>
        <div className="flex items-center justify-between pt-3 border-t border-border">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-5 w-24" />
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * PORow - Table row display
 */
export function PORow({
  po,
  index = 0,
  onClick,
  onSend,
  onCreateGRN,
  onPrint,
}) {
  const statusConfig = getStatusConfig(po.status);

  const canSend = po.status === 'approved';
  const canCreateGRN = ['sent', 'acknowledged', 'receiving', 'partially_received'].includes(po.status);

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
          <FileText className="h-4 w-4 text-muted-foreground" />
          <span className="font-mono text-sm font-medium text-primary">
            {po.po_number || po.number}
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
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm truncate max-w-[200px]">
            {po.supplier_name || po.supplier}
          </span>
        </div>
      </td>
      <td className="px-4 py-3 hidden md:table-cell">
        {po.order_date ? (
          <span className="text-sm font-mono">
            {format(parseISO(po.order_date), 'MMM d, yyyy')}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">-</span>
        )}
      </td>
      <td className="px-4 py-3 hidden lg:table-cell">
        {po.expected_delivery_date ? (
          <span className="text-sm font-mono">
            {format(parseISO(po.expected_delivery_date), 'MMM d, yyyy')}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">-</span>
        )}
      </td>
      <td className="px-4 py-3 text-center">
        <span className="text-sm font-mono">
          {po.items_count || po.item_count || 0}
        </span>
      </td>
      <td className="px-4 py-3 text-right">
        <span className="font-mono text-sm font-semibold text-emerald-500">
          {formatCurrency(po.total_amount || po.total)}
        </span>
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
            {canSend && onSend && (
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onSend(); }}>
                <Send className="h-4 w-4 mr-2" />
                Send to Supplier
              </DropdownMenuItem>
            )}
            {canCreateGRN && onCreateGRN && (
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onCreateGRN(); }}>
                <Package className="h-4 w-4 mr-2" />
                Create GRN
              </DropdownMenuItem>
            )}
            {onPrint && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onPrint(); }}>
                  <Printer className="h-4 w-4 mr-2" />
                  Print
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
 * PORowSkeleton - Loading state for row
 */
export function PORowSkeleton() {
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
      <td className="px-4 py-3">
        <Skeleton className="h-4 w-36" />
      </td>
      <td className="px-4 py-3 hidden md:table-cell">
        <Skeleton className="h-4 w-24" />
      </td>
      <td className="px-4 py-3 hidden lg:table-cell">
        <Skeleton className="h-4 w-24" />
      </td>
      <td className="px-4 py-3 text-center">
        <Skeleton className="h-4 w-8 mx-auto" />
      </td>
      <td className="px-4 py-3 text-right">
        <Skeleton className="h-4 w-24 ml-auto" />
      </td>
      <td className="px-4 py-3">
        <Skeleton className="h-8 w-8" />
      </td>
    </tr>
  );
}
