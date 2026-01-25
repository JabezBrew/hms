import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * StockLevelBadge - Displays stock status with color-coded badge
 * @param {Object} props
 * @param {number} props.stockLevel - Current stock quantity
 * @param {number} props.reorderLevel - Reorder threshold
 * @param {number} [props.maxStock] - Maximum stock level (optional)
 * @param {boolean} [props.showQuantity=true] - Whether to show the quantity
 * @param {string} [props.className] - Additional CSS classes
 */
export function StockLevelBadge({
  stockLevel,
  reorderLevel,
  maxStock,
  showQuantity = true,
  className,
}) {
  const getStockStatus = () => {
    if (stockLevel === 0) {
      return {
        label: 'Out of Stock',
        variant: 'destructive',
        className: 'bg-rose-500 hover:bg-rose-600 text-white',
      };
    }
    if (stockLevel <= reorderLevel) {
      return {
        label: 'Low Stock',
        variant: 'warning',
        className: 'bg-amber-500 hover:bg-amber-600 text-white',
      };
    }
    if (maxStock && stockLevel > maxStock * 0.9) {
      return {
        label: 'Overstocked',
        variant: 'secondary',
        className: 'bg-sky-500 hover:bg-sky-600 text-white',
      };
    }
    return {
      label: 'In Stock',
      variant: 'success',
      className: 'bg-emerald-500 hover:bg-emerald-600 text-white',
    };
  };

  const status = getStockStatus();

  return (
    <Badge className={cn(status.className, className)}>
      {showQuantity ? `${stockLevel} - ${status.label}` : status.label}
    </Badge>
  );
}

/**
 * StockLevelIndicator - Visual bar showing stock level relative to reorder and max
 * @param {Object} props
 * @param {number} props.stockLevel - Current stock quantity
 * @param {number} props.reorderLevel - Reorder threshold
 * @param {number} props.maxStock - Maximum stock level
 * @param {string} [props.className] - Additional CSS classes
 */
export function StockLevelIndicator({
  stockLevel,
  reorderLevel,
  maxStock,
  className,
}) {
  const percentage = Math.min((stockLevel / maxStock) * 100, 100);
  const reorderPercentage = (reorderLevel / maxStock) * 100;

  const getBarColor = () => {
    if (stockLevel === 0) return 'bg-rose-500';
    if (stockLevel <= reorderLevel) return 'bg-amber-500';
    return 'bg-emerald-500';
  };

  return (
    <div className={cn('relative w-full h-2 bg-muted rounded-full overflow-hidden', className)}>
      {/* Reorder level marker */}
      <div
        className="absolute top-0 bottom-0 w-0.5 bg-amber-400/50 z-10"
        style={{ left: `${reorderPercentage}%` }}
        title={`Reorder level: ${reorderLevel}`}
      />
      {/* Stock level bar */}
      <div
        className={cn('h-full transition-all duration-300', getBarColor())}
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}
