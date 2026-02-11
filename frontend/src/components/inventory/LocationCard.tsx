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
import MapPin from 'lucide-react/dist/esm/icons/map-pin.js';
import Warehouse from 'lucide-react/dist/esm/icons/warehouse.js';
import Building2 from 'lucide-react/dist/esm/icons/building-2.js';
import Pill from 'lucide-react/dist/esm/icons/pill.js';
import Bed from 'lucide-react/dist/esm/icons/bed-double.js';
import Thermometer from 'lucide-react/dist/esm/icons/thermometer.js';
import Package from 'lucide-react/dist/esm/icons/package.js';
import MoreHorizontal from 'lucide-react/dist/esm/icons/more-horizontal.js';
import Eye from 'lucide-react/dist/esm/icons/eye.js';
import Edit from 'lucide-react/dist/esm/icons/pencil.js';
import ArrowRightLeft from 'lucide-react/dist/esm/icons/arrow-right-left.js';
import Snowflake from 'lucide-react/dist/esm/icons/snowflake.js';

/**
 * Location type configuration
 */
const LOCATION_TYPES = {
  warehouse: {
    label: 'Warehouse',
    icon: Warehouse,
    color: 'text-amber-500',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/30',
  },
  pharmacy: {
    label: 'Pharmacy',
    icon: Pill,
    color: 'text-emerald-500',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/30',
  },
  ward: {
    label: 'Ward',
    icon: Bed,
    color: 'text-sky-500',
    bgColor: 'bg-sky-500/10',
    borderColor: 'border-sky-500/30',
  },
  department: {
    label: 'Department',
    icon: Building2,
    color: 'text-violet-500',
    bgColor: 'bg-violet-500/10',
    borderColor: 'border-violet-500/30',
  },
  store: {
    label: 'Store',
    icon: Package,
    color: 'text-rose-500',
    bgColor: 'bg-rose-500/10',
    borderColor: 'border-rose-500/30',
  },
};

/**
 * Temperature zone configuration
 */
const TEMP_ZONES = {
  ambient: {
    label: 'Ambient',
    icon: Thermometer,
    color: 'text-muted-foreground',
    range: '15-25°C',
  },
  cold: {
    label: 'Cold Storage',
    icon: Snowflake,
    color: 'text-sky-500',
    range: '2-8°C',
  },
  frozen: {
    label: 'Frozen',
    icon: Snowflake,
    color: 'text-cyan-500',
    range: '-20°C',
  },
  controlled: {
    label: 'Controlled',
    icon: Thermometer,
    color: 'text-amber-500',
    range: 'Variable',
  },
};

/**
 * Get location type config
 */
export function getLocationConfig(type) {
  return LOCATION_TYPES[type?.toLowerCase()] || {
    label: type || 'Location',
    icon: MapPin,
    color: 'text-muted-foreground',
    bgColor: 'bg-muted/50',
    borderColor: 'border-border',
  };
}

/**
 * Get temperature zone config
 */
export function getTempZoneConfig(zone) {
  return TEMP_ZONES[zone?.toLowerCase()] || null;
}

/**
 * Format currency
 */
export function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(amount || 0);
}

/**
 * Format number
 */
export function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(value || 0);
}

/**
 * LocationCard - Card display for storage locations
 * @param {Object} props
 * @param {Object} props.location - Location object
 * @param {number} [props.index=0] - Index for animation delay
 * @param {Function} [props.onClick] - Click handler
 * @param {Function} [props.onViewStock] - View stock callback
 * @param {Function} [props.onEdit] - Edit callback
 * @param {Function} [props.onTransfer] - Transfer to callback
 * @param {string} [props.className] - Additional CSS classes
 */
export function LocationCard({
  location,
  index = 0,
  onClick,
  onViewStock,
  onEdit,
  onTransfer,
  className,
}) {
  const config = getLocationConfig(location.location_type || location.type);
  const tempZone = getTempZoneConfig(location.temperature_zone);
  const Icon = config.icon;

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
          {/* Type badge */}
          <div className={cn(
            'flex items-center gap-1.5 px-2 py-1 rounded-full text-xs',
            config.bgColor,
            config.color
          )}>
            <Icon className="h-3 w-3" />
            <span className="font-medium">{config.label}</span>
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
              {onViewStock && (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onViewStock(); }}>
                  <Eye className="h-4 w-4 mr-2" />
                  View Stock
                </DropdownMenuItem>
              )}
              {onTransfer && (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onTransfer(); }}>
                  <ArrowRightLeft className="h-4 w-4 mr-2" />
                  Transfer To
                </DropdownMenuItem>
              )}
              {(onViewStock || onTransfer) && onEdit && <DropdownMenuSeparator />}
              {onEdit && (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEdit(); }}>
                  <Edit className="h-4 w-4 mr-2" />
                  Edit
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Location name */}
        <h3 className="font-display text-lg text-foreground mb-1 truncate">
          {location.name}
        </h3>

        {/* Code and parent */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
          {location.code && (
            <span className="font-mono">{location.code}</span>
          )}
          {location.parent_name && (
            <>
              <span>•</span>
              <span className="truncate">{location.parent_name}</span>
            </>
          )}
        </div>

        {/* Stats */}
        <div className="flex items-center justify-between pt-3 border-t border-border">
          <div>
            <p className="text-xs text-muted-foreground">Items</p>
            <p className="font-mono text-lg font-semibold">
              {formatNumber(location.item_count || location.items_count || 0)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Stock Value</p>
            <p className="font-mono text-lg font-semibold text-emerald-500">
              {formatCurrency(location.stock_value || location.total_value || 0)}
            </p>
          </div>
        </div>

        {/* Temperature zone indicator */}
        {tempZone && (
          <div className={cn(
            'flex items-center gap-1.5 mt-3 pt-3 border-t border-border text-xs',
            tempZone.color
          )}>
            <tempZone.icon className="h-3 w-3" />
            <span>{tempZone.label}</span>
            <span className="font-mono">({tempZone.range})</span>
          </div>
        )}

        {/* Status indicator */}
        {location.is_active === false && (
          <Badge variant="secondary" className="absolute top-2 right-2 text-[10px]">
            Inactive
          </Badge>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * LocationCardSkeleton - Loading state
 */
export function LocationCardSkeleton() {
  return (
    <Card className="bg-card/30 border-border/50">
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="h-8 w-8" />
        </div>
        <Skeleton className="h-6 w-3/4 mb-1" />
        <Skeleton className="h-4 w-1/2 mb-3" />
        <div className="flex items-center justify-between pt-3 border-t border-border">
          <div>
            <Skeleton className="h-3 w-12 mb-1" />
            <Skeleton className="h-6 w-16" />
          </div>
          <div className="text-right">
            <Skeleton className="h-3 w-16 mb-1" />
            <Skeleton className="h-6 w-20" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * LocationRow - Table row display for locations
 * @param {Object} props
 * @param {Object} props.location - Location object
 * @param {number} [props.index=0] - Index for animation delay
 * @param {Function} [props.onClick] - Click handler
 * @param {Function} [props.onViewStock] - View stock callback
 * @param {Function} [props.onEdit] - Edit callback
 * @param {Function} [props.onTransfer] - Transfer to callback
 */
export function LocationRow({
  location,
  index = 0,
  onClick,
  onViewStock,
  onEdit,
  onTransfer,
}) {
  const config = getLocationConfig(location.location_type || location.type);
  const tempZone = getTempZoneConfig(location.temperature_zone);
  const Icon = config.icon;

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
        <div className="flex items-center gap-3">
          <div className={cn(
            'flex items-center justify-center w-8 h-8 rounded-lg',
            config.bgColor
          )}>
            <Icon className={cn('h-4 w-4', config.color)} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{location.name}</p>
            {location.code && (
              <p className="text-xs text-muted-foreground font-mono">{location.code}</p>
            )}
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <Badge variant="outline" className="text-xs">
          {config.label}
        </Badge>
      </td>
      <td className="px-4 py-3 hidden md:table-cell">
        <span className="text-sm text-muted-foreground">
          {location.parent_name || '-'}
        </span>
      </td>
      <td className="px-4 py-3 text-right font-mono text-sm">
        {formatNumber(location.item_count || location.items_count || 0)}
      </td>
      <td className="px-4 py-3 text-right font-mono text-sm text-emerald-500 hidden lg:table-cell">
        {formatCurrency(location.stock_value || location.total_value || 0)}
      </td>
      <td className="px-4 py-3 hidden sm:table-cell">
        {tempZone && (
          <div className={cn('flex items-center gap-1 text-xs', tempZone.color)}>
            <tempZone.icon className="h-3 w-3" />
            <span>{tempZone.label}</span>
          </div>
        )}
      </td>
      <td className="px-4 py-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {onViewStock && (
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onViewStock(); }}>
                <Eye className="h-4 w-4 mr-2" />
                View Stock
              </DropdownMenuItem>
            )}
            {onTransfer && (
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onTransfer(); }}>
                <ArrowRightLeft className="h-4 w-4 mr-2" />
                Transfer To
              </DropdownMenuItem>
            )}
            {(onViewStock || onTransfer) && onEdit && <DropdownMenuSeparator />}
            {onEdit && (
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEdit(); }}>
                <Edit className="h-4 w-4 mr-2" />
                Edit
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}

/**
 * LocationRowSkeleton - Loading state for row
 */
export function LocationRowSkeleton() {
  return (
    <tr>
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <Skeleton className="w-8 h-8 rounded-lg" />
          <div>
            <Skeleton className="h-4 w-32 mb-1" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <Skeleton className="h-5 w-20" />
      </td>
      <td className="px-4 py-3 hidden md:table-cell">
        <Skeleton className="h-4 w-24" />
      </td>
      <td className="px-4 py-3 text-right">
        <Skeleton className="h-4 w-12 ml-auto" />
      </td>
      <td className="px-4 py-3 text-right hidden lg:table-cell">
        <Skeleton className="h-4 w-16 ml-auto" />
      </td>
      <td className="px-4 py-3 hidden sm:table-cell">
        <Skeleton className="h-4 w-20" />
      </td>
      <td className="px-4 py-3">
        <Skeleton className="h-8 w-8" />
      </td>
    </tr>
  );
}
