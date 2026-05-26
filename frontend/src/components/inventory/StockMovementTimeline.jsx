import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { format, parseISO } from 'date-fns';
import ArrowDown from 'lucide-react/dist/esm/icons/arrow-down.js';
import ArrowUp from 'lucide-react/dist/esm/icons/arrow-up.js';
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right.js';
import Package from 'lucide-react/dist/esm/icons/package.js';
import Truck from 'lucide-react/dist/esm/icons/truck.js';
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw.js';
import ClipboardCheck from 'lucide-react/dist/esm/icons/clipboard-check.js';
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import Settings from 'lucide-react/dist/esm/icons/settings.js';
import Activity from 'lucide-react/dist/esm/icons/activity.js';

const DEFAULT_EMPTY_ARRAY = [];

/**
 * Movement type configuration
 */
const MOVEMENT_TYPES = {
  receipt: {
    label: 'Receipt',
    icon: ArrowDown,
    color: 'text-emerald-500',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/30',
    sign: '+',
  },
  issue: {
    label: 'Issue',
    icon: ArrowUp,
    color: 'text-rose-500',
    bgColor: 'bg-rose-500/10',
    borderColor: 'border-rose-500/30',
    sign: '-',
  },
  transfer_in: {
    label: 'Transfer In',
    icon: Truck,
    color: 'text-sky-500',
    bgColor: 'bg-sky-500/10',
    borderColor: 'border-sky-500/30',
    sign: '+',
  },
  transfer_out: {
    label: 'Transfer Out',
    icon: Truck,
    color: 'text-amber-500',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/30',
    sign: '-',
  },
  adjustment: {
    label: 'Adjustment',
    icon: Settings,
    color: 'text-violet-500',
    bgColor: 'bg-violet-500/10',
    borderColor: 'border-violet-500/30',
    sign: '',
  },
  return: {
    label: 'Return',
    icon: RotateCcw,
    color: 'text-sky-500',
    bgColor: 'bg-sky-500/10',
    borderColor: 'border-sky-500/30',
    sign: '+',
  },
  expired: {
    label: 'Expired',
    icon: AlertCircle,
    color: 'text-rose-500',
    bgColor: 'bg-rose-500/10',
    borderColor: 'border-rose-500/30',
    sign: '-',
  },
  wastage: {
    label: 'Wastage',
    icon: Trash2,
    color: 'text-rose-500',
    bgColor: 'bg-rose-500/10',
    borderColor: 'border-rose-500/30',
    sign: '-',
  },
  count: {
    label: 'Physical Count',
    icon: ClipboardCheck,
    color: 'text-amber-500',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/30',
    sign: '',
  },
  dispensed: {
    label: 'Dispensed',
    icon: Package,
    color: 'text-sky-500',
    bgColor: 'bg-sky-500/10',
    borderColor: 'border-sky-500/30',
    sign: '-',
  },
};

/**
 * Get movement type config
 */
function getMovementConfig(type) {
  return MOVEMENT_TYPES[type] || {
    label: type?.replace(/_/g, ' ')?.replace(/\b\w/g, l => l.toUpperCase()) || 'Unknown',
    icon: Activity,
    color: 'text-muted-foreground',
    bgColor: 'bg-muted/50',
    borderColor: 'border-border',
    sign: '',
  };
}

/**
 * Format quantity with sign
 */
function formatQuantity(quantity, type) {
  const config = getMovementConfig(type);
  const absQty = Math.abs(quantity);

  if (config.sign === '+') {
    return `+${absQty}`;
  } else if (config.sign === '-') {
    return `-${absQty}`;
  }

  // For adjustments, show actual sign
  if (quantity > 0) return `+${absQty}`;
  if (quantity < 0) return `-${absQty}`;
  return '0';
}

/**
 * StockMovementTimelineItem - Individual movement entry
 */
function StockMovementTimelineItem({
  movement,
  isLast,
  showLocation = true,
  onClick,
}) {
  const config = getMovementConfig(movement.movement_type);
  const Icon = config.icon;

  const timestamp = movement.created_at || movement.timestamp;
  const formattedDate = timestamp
    ? format(parseISO(timestamp), 'MMM d, yyyy')
    : '';
  const formattedTime = timestamp
    ? format(parseISO(timestamp), 'HH:mm')
    : '';

  return (
    <div
      className={cn(
        'relative flex gap-4',
        onClick && 'cursor-pointer hover:bg-muted/30 -mx-2 px-2 py-1 rounded-lg transition-colors'
      )}
      onClick={onClick}
    >
      {/* Timeline line */}
      <div className="flex flex-col items-center">
        <div
          className={cn(
            'flex items-center justify-center size-8 rounded-full border-2 shrink-0',
            config.bgColor,
            config.borderColor
          )}
        >
          <Icon className={cn('size-4', config.color)} />
        </div>
        {!isLast && (
          <div className="w-0.5 flex-1 bg-border mt-1" />
        )}
      </div>

      {/* Content */}
      <div className={cn('flex-1 pb-6', isLast && 'pb-0')}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            {/* Movement type and quantity */}
            <div className="flex items-center gap-2 mb-1">
              <span className={cn('font-medium text-sm', config.color)}>
                {config.label}
              </span>
              <span
                className={cn(
                  'font-mono text-sm font-semibold',
                  movement.quantity > 0 ? 'text-emerald-500' : 'text-rose-500'
                )}
              >
                {formatQuantity(movement.quantity, movement.movement_type)}
              </span>
              {movement.unit && (
                <span className="text-xs text-muted-foreground">
                  {movement.unit}
                </span>
              )}
            </div>

            {/* Reference and location */}
            <div className="space-y-1">
              {movement.reference_number && (
                <p className="text-xs text-muted-foreground">
                  Ref: <span className="font-mono">{movement.reference_number}</span>
                </p>
              )}
              {showLocation && movement.location_name && (
                <p className="text-xs text-muted-foreground">
                  Location: {movement.location_name}
                </p>
              )}
              {movement.batch_number && (
                <p className="text-xs text-muted-foreground">
                  Batch: <span className="font-mono">{movement.batch_number}</span>
                </p>
              )}
              {movement.notes && (
                <p className="text-xs text-muted-foreground mt-1">
                  {movement.notes}
                </p>
              )}
            </div>

            {/* User info */}
            {movement.performed_by_name && (
              <p className="text-xs text-muted-foreground mt-1">
                By: {movement.performed_by_name}
              </p>
            )}
          </div>

          {/* Timestamp and balance */}
          <div className="text-right shrink-0">
            <p className="font-mono text-xs text-muted-foreground">
              {formattedDate}
            </p>
            <p className="font-mono text-xs text-muted-foreground">
              {formattedTime}
            </p>
            {movement.balance_after !== undefined && (
              <p className="font-mono text-xs mt-1">
                Balance: <span className="font-semibold">{movement.balance_after}</span>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * StockMovementTimelineSkeleton - Loading state
 */
function StockMovementTimelineSkeleton({ count = 5 }) {
  return (
    <div className="space-y-4">
      {[...Array(count)].map((_, i) => (
        <div key={i} className="flex gap-4">
          <div className="flex flex-col items-center">
            <Skeleton className="size-8 rounded-full" />
            {i < count - 1 && <Skeleton className="w-0.5 flex-1 mt-1" />}
          </div>
          <div className="flex-1 pb-6">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-48" />
                <Skeleton className="h-3 w-24" />
              </div>
              <div className="text-right">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 w-12 mt-1" />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * StockMovementTimeline - Timeline component for stock movements
 * @param {Object} props
 * @param {Array} props.movements - Array of movement objects
 * @param {boolean} [props.isLoading] - Loading state
 * @param {boolean} [props.showLocation=true] - Whether to show location
 * @param {number} [props.limit] - Max items to show
 * @param {Function} [props.onViewAll] - View all callback
 * @param {Function} [props.onMovementClick] - Movement click callback
 * @param {string} [props.className] - Additional CSS classes
 */
export function StockMovementTimeline({
  movements = DEFAULT_EMPTY_ARRAY,
  isLoading,
  showLocation = true,
  limit,
  onViewAll,
  onMovementClick,
  className,
}) {
  if (isLoading) {
    return (
      <Card className={cn('bg-card/30 border-border/50', className)}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="size-5 text-sky-500" />
            Stock Movements
          </CardTitle>
        </CardHeader>
        <CardContent>
          <StockMovementTimelineSkeleton count={limit || 5} />
        </CardContent>
      </Card>
    );
  }

  const displayMovements = limit ? movements.slice(0, limit) : movements;
  const hasMore = limit && movements.length > limit;

  if (!movements || movements.length === 0) {
    return (
      <Card className={cn('bg-card/30 border-border/50', className)}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="size-5 text-sky-500" />
            Stock Movements
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Package className="size-10 text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground">
              No movements recorded
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn('bg-card/30 border-border/50', className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="size-5 text-sky-500" />
            Stock Movements
            <span className="text-sm font-normal text-muted-foreground">
              ({movements.length})
            </span>
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-0">
          {displayMovements.map((movement, index) => (
            <StockMovementTimelineItem
              key={movement.id || index}
              movement={movement}
              isLast={index === displayMovements.length - 1 && !hasMore}
              showLocation={showLocation}
              onClick={onMovementClick ? () => onMovementClick(movement) : undefined}
            />
          ))}
        </div>
        {hasMore && onViewAll && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full mt-2"
            onClick={onViewAll}
          >
            View all {movements.length} movements
            <ArrowRight className="size-4 ml-1" />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * InlineStockMovementTimeline - Minimal timeline without card wrapper
 * @param {Object} props
 * @param {Array} props.movements - Array of movement objects
 * @param {boolean} [props.isLoading] - Loading state
 * @param {boolean} [props.showLocation=true] - Whether to show location
 * @param {number} [props.limit] - Max items to show
 * @param {Function} [props.onViewAll] - View all callback
 * @param {Function} [props.onMovementClick] - Movement click callback
 * @param {string} [props.className] - Additional CSS classes
 */
export function InlineStockMovementTimeline({
  movements = DEFAULT_EMPTY_ARRAY,
  isLoading,
  showLocation = true,
  limit,
  onViewAll,
  onMovementClick,
  className,
}) {
  if (isLoading) {
    return (
      <div className={className}>
        <StockMovementTimelineSkeleton count={limit || 5} />
      </div>
    );
  }

  const displayMovements = limit ? movements.slice(0, limit) : movements;
  const hasMore = limit && movements.length > limit;

  if (!movements || movements.length === 0) {
    return (
      <div className={cn('flex flex-col items-center justify-center py-8 text-center', className)}>
        <Package className="size-10 text-muted-foreground/50 mb-3" />
        <p className="text-sm text-muted-foreground">
          No movements recorded
        </p>
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="space-y-0">
        {displayMovements.map((movement, index) => (
          <StockMovementTimelineItem
            key={movement.id || index}
            movement={movement}
            isLast={index === displayMovements.length - 1 && !hasMore}
            showLocation={showLocation}
            onClick={onMovementClick ? () => onMovementClick(movement) : undefined}
          />
        ))}
      </div>
      {hasMore && onViewAll && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full mt-2"
          onClick={onViewAll}
        >
          View all {movements.length} movements
          <ArrowRight className="size-4 ml-1" />
        </Button>
      )}
    </div>
  );
}
