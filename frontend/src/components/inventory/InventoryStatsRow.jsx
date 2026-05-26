import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import Package from 'lucide-react/dist/esm/icons/package.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import DollarSign from 'lucide-react/dist/esm/icons/dollar-sign.js';
import TrendingUp from 'lucide-react/dist/esm/icons/trending-up.js';
import TrendingDown from 'lucide-react/dist/esm/icons/trending-down.js';

const USD_COMPACT_CURRENCY_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});

const US_NUMBER_FORMATTER = new Intl.NumberFormat('en-US');

/**
 * StatCard - Individual stat card component
 */
function StatCard({
  label,
  value,
  icon: Icon,
  trend,
  trendValue,
  onClick,
  variant = 'default',
  className,
}) {
  const variantStyles = {
    default: 'bg-card/30 border-border/50 hover:border-border',
    warning: 'bg-amber-500/10 border-amber-500/30 hover:border-amber-500/50',
    danger: 'bg-rose-500/10 border-rose-500/30 hover:border-rose-500/50',
    success: 'bg-emerald-500/10 border-emerald-500/30 hover:border-emerald-500/50',
  };

  const iconStyles = {
    default: 'text-muted-foreground',
    warning: 'text-amber-500',
    danger: 'text-rose-500',
    success: 'text-emerald-500',
  };

  return (
    <Card
      className={cn(
        'transition-all duration-200 cursor-pointer',
        variantStyles[variant],
        className
      )}
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="font-mono text-2xl font-semibold">{value}</p>
            {trend !== undefined && trendValue && (
              <div className="flex items-center gap-1 text-xs">
                {trend === 'up' ? (
                  <TrendingUp className="size-3 text-emerald-500" />
                ) : (
                  <TrendingDown className="size-3 text-rose-500" />
                )}
                <span className={cn(
                  trend === 'up' ? 'text-emerald-500' : 'text-rose-500'
                )}>
                  {trendValue}
                </span>
              </div>
            )}
          </div>
          {Icon && (
            <div className={cn('p-2 rounded-lg bg-muted/50', iconStyles[variant])}>
              <Icon className="size-5" />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * InventoryStatsRow - Row of KPI cards for inventory dashboard
 * @param {Object} props
 * @param {Object} props.stats - Stats data
 * @param {number} props.stats.total_items - Total inventory items
 * @param {number} props.stats.low_stock_count - Items with low stock
 * @param {number} props.stats.expiring_soon_count - Items expiring soon
 * @param {number} props.stats.total_stock_value - Total stock value
 * @param {boolean} [props.isLoading] - Loading state
 * @param {string} [props.className] - Additional CSS classes
 */
export function InventoryStatsRow({ stats, isLoading, className }) {
  const navigate = useNavigate();

  const formatCurrency = (value) => {
    return USD_COMPACT_CURRENCY_FORMATTER.format(value);
  };

  const formatNumber = (value) => {
    return US_NUMBER_FORMATTER.format(value);
  };

  if (isLoading) {
    return (
      <div className={cn('grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4', className)}>
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="bg-card/30 border-border/50">
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-8 w-16" />
                </div>
                <Skeleton className="size-9 rounded-lg" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className={cn('grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4', className)}>
      <StatCard
        label="Total Items"
        value={formatNumber(stats?.total_items || 0)}
        icon={Package}
        onClick={() => navigate('/inventory/items')}
      />
      <StatCard
        label="Low Stock"
        value={formatNumber(stats?.low_stock_count || 0)}
        icon={AlertTriangle}
        variant={stats?.low_stock_count > 0 ? 'warning' : 'default'}
        onClick={() => navigate('/inventory/items?status=low_stock')}
      />
      <StatCard
        label="Expiring Soon"
        value={formatNumber(stats?.expiring_soon_count || 0)}
        icon={Clock}
        variant={stats?.expiring_soon_count > 0 ? 'danger' : 'default'}
        onClick={() => navigate('/inventory/items?status=expiring')}
      />
      <StatCard
        label="Stock Value"
        value={formatCurrency(stats?.total_stock_value || 0)}
        icon={DollarSign}
        variant="success"
        onClick={() => navigate('/inventory/analytics?tab=valuation')}
      />
    </div>
  );
}
