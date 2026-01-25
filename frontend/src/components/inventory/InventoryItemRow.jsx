import { useNavigate } from 'react-router-dom';
import { TableCell, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { StockLevelBadge } from './StockLevelBadge';
import { ExpiryBadge } from './ExpiryBadge';
import { cn } from '@/lib/utils';
import Eye from 'lucide-react/dist/esm/icons/eye.js';
import Edit from 'lucide-react/dist/esm/icons/edit.js';
import ShoppingCart from 'lucide-react/dist/esm/icons/shopping-cart.js';
import MoreHorizontal from 'lucide-react/dist/esm/icons/more-horizontal.js';

/**
 * InventoryItemRow - Table row display for inventory items
 * @param {Object} props
 * @param {Object} props.item - The inventory item
 * @param {string} props.item.id - Item ID
 * @param {string} props.item.name - Item name
 * @param {string} props.item.sku - SKU code
 * @param {string} [props.item.category_name] - Category name
 * @param {number} props.item.total_stock - Total stock quantity
 * @param {number} props.item.reorder_level - Reorder threshold
 * @param {number} props.item.unit_price - Unit price
 * @param {string} [props.item.unit_of_measure] - Unit of measure
 * @param {string} [props.item.nearest_expiry] - Nearest expiry date
 * @param {boolean} [props.item.is_controlled] - Is controlled substance
 * @param {boolean} [props.selected] - Whether row is selected
 * @param {Function} [props.onSelect] - Selection callback
 * @param {Function} [props.onEdit] - Edit callback
 * @param {Function} [props.onOrder] - Order callback
 * @param {string} [props.className] - Additional CSS classes
 */
export function InventoryItemRow({
  item,
  selected = false,
  onSelect,
  onEdit,
  onOrder,
  className,
}) {
  const navigate = useNavigate();

  const handleClick = () => {
    navigate(`/inventory/items/${item.id}`);
  };

  const handleCheckboxChange = (checked) => {
    if (onSelect) {
      onSelect(item.id, checked);
    }
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
    <TableRow
      className={cn(
        'cursor-pointer hover:bg-muted/50',
        selected && 'bg-muted/30',
        className
      )}
      onClick={handleClick}
    >
      {onSelect && (
        <TableCell className="w-12" onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={selected}
            onCheckedChange={handleCheckboxChange}
          />
        </TableCell>
      )}
      <TableCell className="max-w-[200px]">
        <div className="truncate">
          <span className="font-medium">{item.name}</span>
          {item.is_controlled && (
            <Badge className="ml-2 bg-purple-500 hover:bg-purple-600 text-white text-xs">
              Controlled
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell>
        <span className="font-mono text-sm text-muted-foreground">
          {item.sku}
        </span>
      </TableCell>
      <TableCell>
        {item.category_name ? (
          <Badge variant="outline" className="text-xs">
            {item.category_name}
          </Badge>
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </TableCell>
      <TableCell>
        <StockLevelBadge
          stockLevel={item.total_stock || 0}
          reorderLevel={item.reorder_level}
          showQuantity={true}
        />
      </TableCell>
      <TableCell>
        {item.nearest_expiry ? (
          <ExpiryBadge expiryDate={item.nearest_expiry} />
        ) : (
          <span className="text-muted-foreground text-sm">-</span>
        )}
      </TableCell>
      <TableCell className="text-right">
        <span className="font-mono">{formatPrice(item.unit_price)}</span>
        <span className="text-muted-foreground text-xs ml-1">
          /{item.unit_of_measure || 'ea'}
        </span>
      </TableCell>
      <TableCell className="w-12" onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
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
      </TableCell>
    </TableRow>
  );
}

/**
 * InventoryItemRowSkeleton - Loading skeleton for table row
 */
export function InventoryItemRowSkeleton({ showCheckbox = false }) {
  return (
    <TableRow>
      {showCheckbox && (
        <TableCell className="w-12">
          <div className="h-4 w-4 bg-muted rounded animate-pulse" />
        </TableCell>
      )}
      <TableCell>
        <div className="h-5 w-32 bg-muted rounded animate-pulse" />
      </TableCell>
      <TableCell>
        <div className="h-4 w-20 bg-muted rounded animate-pulse" />
      </TableCell>
      <TableCell>
        <div className="h-5 w-16 bg-muted rounded animate-pulse" />
      </TableCell>
      <TableCell>
        <div className="h-5 w-20 bg-muted rounded animate-pulse" />
      </TableCell>
      <TableCell>
        <div className="h-5 w-12 bg-muted rounded animate-pulse" />
      </TableCell>
      <TableCell>
        <div className="h-4 w-16 bg-muted rounded animate-pulse ml-auto" />
      </TableCell>
      <TableCell className="w-12">
        <div className="h-8 w-8 bg-muted rounded animate-pulse" />
      </TableCell>
    </TableRow>
  );
}
