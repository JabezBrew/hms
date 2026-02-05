import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StockLevelBadge } from './StockLevelBadge';
import { cn } from '@/lib/utils';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js';
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right.js';
import ShoppingCart from 'lucide-react/dist/esm/icons/shopping-cart.js';
import Package from 'lucide-react/dist/esm/icons/package.js';

/**
 * LowStockAlert - Widget showing items with low stock
 * @param {Object} props
 * @param {Array} props.items - Array of low stock items
 * @param {number} [props.limit=10] - Maximum items to display
 * @param {boolean} [props.isLoading] - Loading state
 * @param {Function} [props.onCreateRequisition] - Create requisition callback
 * @param {string} [props.className] - Additional CSS classes
 */
export function LowStockAlert({
  items = [],
  limit = 10,
  isLoading,
  onCreateRequisition,
  className,
}) {
  const navigate = useNavigate();
  const displayItems = items.slice(0, limit);

  const handleItemClick = (itemId) => {
    navigate(`/inventory/items/${itemId}`);
  };

  const handleViewAll = () => {
    navigate('/inventory/items?status=low_stock');
  };

  if (isLoading) {
    return (
      <Card className={cn('bg-card/30 border-border/50', className)}>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-5 rounded" />
            <Skeleton className="h-5 w-32" />
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
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Low Stock Alerts
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Package className="h-10 w-10 text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground">
              All items are well stocked
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
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Low Stock Alerts
            <span className="text-sm font-normal text-muted-foreground">
              ({items.length})
            </span>
          </CardTitle>
          {onCreateRequisition && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onCreateRequisition(items)}
            >
              <ShoppingCart className="h-4 w-4 mr-1" />
              Order
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-1">
        {displayItems.map((item) => (
          <div
            key={item.id}
            className="flex items-center justify-between py-2 px-2 -mx-2 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
            onClick={() => handleItemClick(item.id)}
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{item.name}</p>
              <p className="text-xs text-muted-foreground">
                <span className="font-mono">{item.sku}</span>
                {item.shortfall && (
                  <span className="text-rose-500 ml-2">
                    Need {item.shortfall} more
                  </span>
                )}
              </p>
            </div>
            <StockLevelBadge
              stockLevel={item.total_stock || item.stock_level || 0}
              reorderLevel={item.reorder_level}
              showQuantity={true}
            />
          </div>
        ))}
        {items.length > limit && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full mt-2"
            onClick={handleViewAll}
          >
            View all {items.length} items
            <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
