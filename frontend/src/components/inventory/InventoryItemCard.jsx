import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { StockLevelBadge, StockLevelIndicator } from './StockLevelBadge';
import { ExpiryBadge } from './ExpiryBadge';
import { cn } from '@/lib/utils';
import Eye from 'lucide-react/dist/esm/icons/eye.js';
import Edit from 'lucide-react/dist/esm/icons/edit.js';
import ShoppingCart from 'lucide-react/dist/esm/icons/shopping-cart.js';
import MoreVertical from 'lucide-react/dist/esm/icons/more-vertical.js';

/**
 * InventoryItemCard - Card display for inventory items in grid view
 * @param {Object} props
 * @param {Object} props.item - The inventory item
 * @param {string} props.item.id - Item ID
 * @param {string} props.item.name - Item name
 * @param {string} props.item.sku - SKU code
 * @param {string} [props.item.category_name] - Category name
 * @param {number} props.item.total_stock - Total stock quantity
 * @param {number} props.item.reorder_level - Reorder threshold
 * @param {number} [props.item.max_stock_level] - Maximum stock level
 * @param {number} props.item.unit_price - Unit price
 * @param {string} [props.item.unit_of_measure] - Unit of measure
 * @param {string} [props.item.nearest_expiry] - Nearest expiry date
 * @param {boolean} [props.item.is_controlled] - Is controlled substance
 * @param {Function} [props.onEdit] - Edit callback
 * @param {Function} [props.onOrder] - Order callback
 * @param {string} [props.className] - Additional CSS classes
 */
export function InventoryItemCard({
  item,
  onEdit,
  onOrder,
  className,
}) {
  const navigate = useNavigate();

  const handleClick = () => {
    navigate(`/inventory/items/${item.id}`);
  };

  const handleEditClick = (e) => {
    e.stopPropagation();
    if (onEdit) {
      onEdit(item);
    }
  };

  const handleOrderClick = (e) => {
    e.stopPropagation();
    if (onOrder) {
      onOrder(item);
    }
  };

  const formatPrice = (price) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(price);
  };

  return (
    <Card
      className={cn(
        'group cursor-pointer transition-all duration-200',
        'hover:border-border hover:shadow-md',
        'bg-card/30 border-border/50',
        className
      )}
      onClick={handleClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="font-display text-lg font-medium truncate">
              {item.name}
            </h3>
            <p className="font-mono text-sm text-muted-foreground">
              {item.sku}
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleClick}>
                <Eye className="h-4 w-4 mr-2" />
                View Details
              </DropdownMenuItem>
              {onEdit && (
                <DropdownMenuItem onClick={handleEditClick}>
                  <Edit className="h-4 w-4 mr-2" />
                  Edit
                </DropdownMenuItem>
              )}
              {onOrder && (
                <DropdownMenuItem onClick={handleOrderClick}>
                  <ShoppingCart className="h-4 w-4 mr-2" />
                  Create Order
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Category and badges */}
        <div className="flex flex-wrap gap-1.5">
          {item.category_name && (
            <Badge variant="outline" className="text-xs">
              {item.category_name}
            </Badge>
          )}
          {item.is_controlled && (
            <Badge className="bg-purple-500 hover:bg-purple-600 text-white text-xs">
              Controlled
            </Badge>
          )}
        </div>

        {/* Stock level */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <StockLevelBadge
              stockLevel={item.total_stock || 0}
              reorderLevel={item.reorder_level}
              maxStock={item.max_stock_level}
              showQuantity={true}
            />
            {item.nearest_expiry && (
              <ExpiryBadge
                expiryDate={item.nearest_expiry}
                hideIfOk={true}
              />
            )}
          </div>
          {item.max_stock_level && (
            <StockLevelIndicator
              stockLevel={item.total_stock || 0}
              reorderLevel={item.reorder_level}
              maxStock={item.max_stock_level}
            />
          )}
        </div>

        {/* Price and unit */}
        <div className="flex items-center justify-between text-sm pt-1 border-t border-border/50">
          <span className="text-muted-foreground">
            {item.unit_of_measure || 'Each'}
          </span>
          <span className="font-mono font-medium">
            {formatPrice(item.unit_price)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * InventoryItemCardSkeleton - Loading skeleton for item card
 */
export function InventoryItemCardSkeleton() {
  return (
    <Card className="bg-card/30 border-border/50">
      <CardHeader className="pb-2">
        <div className="space-y-2">
          <div className="h-5 w-3/4 bg-muted rounded animate-pulse" />
          <div className="h-4 w-1/3 bg-muted rounded animate-pulse" />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-1.5">
          <div className="h-5 w-16 bg-muted rounded animate-pulse" />
        </div>
        <div className="space-y-1.5">
          <div className="h-5 w-24 bg-muted rounded animate-pulse" />
          <div className="h-2 w-full bg-muted rounded animate-pulse" />
        </div>
        <div className="flex items-center justify-between pt-1 border-t border-border/50">
          <div className="h-4 w-12 bg-muted rounded animate-pulse" />
          <div className="h-4 w-16 bg-muted rounded animate-pulse" />
        </div>
      </CardContent>
    </Card>
  );
}
