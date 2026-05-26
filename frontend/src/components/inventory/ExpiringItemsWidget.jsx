import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ExpiryBadge, ExpiryDateDisplay } from './ExpiryBadge';
import { cn } from '@/lib/utils';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right.js';
import Package from 'lucide-react/dist/esm/icons/package.js';
import { format, parseISO, differenceInDays } from 'date-fns';

const DEFAULT_EMPTY_ARRAY = [];

/**
 * ExpiringItemsWidget - Widget showing items expiring soon
 * @param {Object} props
 * @param {Array} props.items - Array of expiring items/batches
 * @param {number} [props.daysThreshold=30] - Days threshold for expiring soon
 * @param {number} [props.limit=10] - Maximum items to display
 * @param {boolean} [props.isLoading] - Loading state
 * @param {string} [props.className] - Additional CSS classes
 */
export function ExpiringItemsWidget({
  items = DEFAULT_EMPTY_ARRAY,
  daysThreshold = 30,
  limit = 10,
  isLoading,
  className,
}) {
  const navigate = useNavigate();
  const displayItems = items.slice(0, limit);

  // Sort by expiry date (soonest first)
  const sortedItems = displayItems.toSorted((a, b) => {
    const dateA = parseISO(a.expiry_date);
    const dateB = parseISO(b.expiry_date);
    return dateA - dateB;
  });

  const handleItemClick = (item) => {
    // Navigate to item detail page
    if (item.item_id || item.item) {
      navigate(`/inventory/items/${item.item_id || item.item}`);
    }
  };

  const handleViewAll = () => {
    navigate('/inventory/items?status=expiring');
  };

  const getDaysUntilExpiry = (expiryDate) => {
    const date = typeof expiryDate === 'string' ? parseISO(expiryDate) : expiryDate;
    return differenceInDays(date, new Date());
  };

  if (isLoading) {
    return (
      <Card className={cn('bg-card/30 border-border/50', className)}>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Skeleton className="size-5 rounded" />
            <Skeleton className="h-5 w-40" />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center justify-between py-2">
              <div className="space-y-1">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-5 w-16" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  if (!items || items.length === 0) {
    return (
      <Card className={cn('bg-card/30 border-border/50', className)}>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="size-5 text-rose-500" />
            Expiring Soon ({daysThreshold} days)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Package className="size-10 text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground">
              No items expiring soon
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
            <Clock className="size-5 text-rose-500" />
            Expiring Soon
            <span className="text-sm font-normal text-muted-foreground">
              ({items.length})
            </span>
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-1">
        {sortedItems.map((item, index) => {
          const daysLeft = getDaysUntilExpiry(item.expiry_date);
          const isUrgent = daysLeft <= 7;
          const isExpired = daysLeft < 0;

          return (
            <div
              key={item.id || index}
              className={cn(
                'flex items-center justify-between py-2 px-2 -mx-2 rounded-lg cursor-pointer transition-colors',
                isExpired ? 'bg-rose-500/10 hover:bg-rose-500/20' :
                isUrgent ? 'hover:bg-rose-500/10' : 'hover:bg-muted/50'
              )}
              onClick={() => handleItemClick(item)}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">
                  {item.item_name || item.name}
                </p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {item.batch_number && (
                    <span className="font-mono">Batch: {item.batch_number}</span>
                  )}
                  {item.quantity && (
                    <span>Qty: {item.quantity}</span>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <ExpiryBadge expiryDate={item.expiry_date} />
                <span className="text-xs text-muted-foreground font-mono">
                  {format(parseISO(item.expiry_date), 'MMM d, yyyy')}
                </span>
              </div>
            </div>
          );
        })}
        {items.length > limit && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full mt-2"
            onClick={handleViewAll}
          >
            View all {items.length} items
            <ArrowRight className="size-4 ml-1" />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
