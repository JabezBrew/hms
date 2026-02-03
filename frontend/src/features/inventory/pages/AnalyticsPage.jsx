import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useConsumptionAnalytics,
  useABCAnalysis,
  useSupplierPerformance,
  useStockValuation,
} from '@/features/inventory/hooks';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import BarChart3 from 'lucide-react/dist/esm/icons/bar-chart-3.js';
import TrendingUp from 'lucide-react/dist/esm/icons/trending-up.js';
import TrendingDown from 'lucide-react/dist/esm/icons/trending-down.js';
import DollarSign from 'lucide-react/dist/esm/icons/dollar-sign.js';
import Package from 'lucide-react/dist/esm/icons/package.js';
import Building2 from 'lucide-react/dist/esm/icons/building-2.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js';
import PieChart from 'lucide-react/dist/esm/icons/pie-chart.js';

const PERIOD_OPTIONS = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: '1y', label: 'Last year' },
];

/**
 * Format currency
 */
function formatCurrency(amount) {
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
function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(value || 0);
}

/**
 * Format percentage
 */
function formatPercent(value) {
  return `${(value || 0).toFixed(1)}%`;
}

/**
 * StatCard - Summary statistic card
 */
function StatCard({ title, value, subtitle, icon: Icon, trend, trendValue, variant = 'default' }) {
  const variantStyles = {
    default: 'bg-card/30 border-border/50',
    warning: 'bg-amber-500/10 border-amber-500/30',
    danger: 'bg-rose-500/10 border-rose-500/30',
    success: 'bg-emerald-500/10 border-emerald-500/30',
  };

  const iconStyles = {
    default: 'text-muted-foreground',
    warning: 'text-amber-500',
    danger: 'text-rose-500',
    success: 'text-emerald-500',
  };

  return (
    <Card className={variantStyles[variant]}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="font-mono text-2xl font-semibold mt-1">{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
            {trend !== undefined && trendValue && (
              <div className="flex items-center gap-1 mt-2 text-xs">
                {trend === 'up' ? (
                  <TrendingUp className="h-3 w-3 text-emerald-500" />
                ) : (
                  <TrendingDown className="h-3 w-3 text-rose-500" />
                )}
                <span className={trend === 'up' ? 'text-emerald-500' : 'text-rose-500'}>
                  {trendValue}
                </span>
              </div>
            )}
          </div>
          {Icon && (
            <div className={cn('p-2 rounded-lg bg-muted/50', iconStyles[variant])}>
              <Icon className="h-5 w-5" />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * ConsumptionTab - Consumption analytics view
 */
function ConsumptionTab({ period }) {
  const { data, isLoading } = useConsumptionAnalytics({ period });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  const stats = data || {};
  const topItems = stats.top_consumed_items || [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Consumption"
          value={formatNumber(stats.total_quantity || 0)}
          subtitle="units consumed"
          icon={Package}
        />
        <StatCard
          title="Consumption Value"
          value={formatCurrency(stats.total_value || 0)}
          icon={DollarSign}
          variant="success"
        />
        <StatCard
          title="Unique Items"
          value={formatNumber(stats.unique_items || 0)}
          icon={BarChart3}
        />
        <StatCard
          title="Avg Daily Consumption"
          value={formatNumber(stats.avg_daily || 0)}
          subtitle="units/day"
          icon={TrendingUp}
        />
      </div>

      {/* Top Consumed Items */}
      <Card className="bg-card/30 border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="h-5 w-5 text-sky-500" />
            Top Consumed Items
          </CardTitle>
        </CardHeader>
        <CardContent>
          {topItems.length > 0 ? (
            <div className="space-y-3">
              {topItems.map((item, index) => (
                <div
                  key={item.id || index}
                  className="flex items-center justify-between py-2 px-2 -mx-2 rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm text-muted-foreground w-6">
                      {index + 1}.
                    </span>
                    <div>
                      <p className="text-sm font-medium">{item.name || item.item_name}</p>
                      {item.category && (
                        <p className="text-xs text-muted-foreground">{item.category}</p>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-sm font-semibold">
                      {formatNumber(item.quantity || item.consumed)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatCurrency(item.value)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Package className="h-10 w-10 text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">No consumption data available</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * ABCAnalysisTab - ABC inventory analysis view
 */
function ABCAnalysisTab() {
  const { data, isLoading } = useABCAnalysis();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  const analysis = data || {};
  const categories = [
    { key: 'A', label: 'Class A', description: 'High value items (70-80% value, 10-20% items)', color: 'text-emerald-500', bgColor: 'bg-emerald-500/10' },
    { key: 'B', label: 'Class B', description: 'Medium value items (15-25% value, 30% items)', color: 'text-amber-500', bgColor: 'bg-amber-500/10' },
    { key: 'C', label: 'Class C', description: 'Low value items (5% value, 50% items)', color: 'text-sky-500', bgColor: 'bg-sky-500/10' },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {categories.map((cat) => {
          const catData = analysis[`class_${cat.key.toLowerCase()}`] || {};
          return (
            <Card key={cat.key} className="bg-card/30 border-border/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className={cn('px-2 py-1 rounded text-sm font-semibold', cat.bgColor, cat.color)}>
                    {cat.label}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mb-3">{cat.description}</p>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Items</span>
                    <span className="font-mono font-semibold">{formatNumber(catData.count || 0)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Value</span>
                    <span className="font-mono font-semibold">{formatCurrency(catData.value || 0)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">% of Total</span>
                    <span className="font-mono font-semibold">{formatPercent(catData.percentage || 0)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* ABC Distribution visualization placeholder */}
      <Card className="bg-card/30 border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <PieChart className="h-5 w-5 text-violet-500" />
            ABC Distribution
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12 text-center">
            <div>
              <PieChart className="h-16 w-16 text-muted-foreground/30 mx-auto mb-4" />
              <p className="text-sm text-muted-foreground">
                Chart visualization would be rendered here
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                (Integrate with a charting library like Recharts)
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * SupplierTab - Supplier performance view
 */
function SupplierTab({ period }) {
  const { data, isLoading } = useSupplierPerformance({ period });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  const stats = data || {};
  const suppliers = stats.suppliers || [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          title="Total Suppliers"
          value={formatNumber(stats.total_suppliers || 0)}
          icon={Building2}
        />
        <StatCard
          title="On-Time Delivery"
          value={formatPercent(stats.on_time_delivery_rate || 0)}
          icon={TrendingUp}
          variant="success"
        />
        <StatCard
          title="Quality Issues"
          value={formatNumber(stats.quality_issues || 0)}
          icon={AlertTriangle}
          variant={stats.quality_issues > 0 ? 'warning' : 'default'}
        />
      </div>

      {/* Supplier Performance Table */}
      <Card className="bg-card/30 border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-5 w-5 text-amber-500" />
            Supplier Performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          {suppliers.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 text-xs font-mono text-muted-foreground">Supplier</th>
                    <th className="text-right py-2 text-xs font-mono text-muted-foreground">Orders</th>
                    <th className="text-right py-2 text-xs font-mono text-muted-foreground">On-Time %</th>
                    <th className="text-right py-2 text-xs font-mono text-muted-foreground">Quality %</th>
                    <th className="text-right py-2 text-xs font-mono text-muted-foreground">Avg Lead Time</th>
                  </tr>
                </thead>
                <tbody>
                  {suppliers.map((supplier, index) => (
                    <tr key={supplier.id || index} className="border-b border-border/50">
                      <td className="py-3 text-sm">{supplier.name}</td>
                      <td className="py-3 text-right font-mono text-sm">
                        {formatNumber(supplier.order_count || 0)}
                      </td>
                      <td className="py-3 text-right font-mono text-sm">
                        <span className={cn(
                          (supplier.on_time_rate || 0) >= 90 ? 'text-emerald-500' :
                          (supplier.on_time_rate || 0) >= 70 ? 'text-amber-500' : 'text-rose-500'
                        )}>
                          {formatPercent(supplier.on_time_rate || 0)}
                        </span>
                      </td>
                      <td className="py-3 text-right font-mono text-sm">
                        <span className={cn(
                          (supplier.quality_rate || 0) >= 95 ? 'text-emerald-500' :
                          (supplier.quality_rate || 0) >= 85 ? 'text-amber-500' : 'text-rose-500'
                        )}>
                          {formatPercent(supplier.quality_rate || 0)}
                        </span>
                      </td>
                      <td className="py-3 text-right font-mono text-sm">
                        {supplier.avg_lead_time ? `${supplier.avg_lead_time} days` : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <Building2 className="h-10 w-10 text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground">No supplier data available</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * ValuationTab - Stock valuation view
 */
function ValuationTab() {
  const { data, isLoading } = useStockValuation();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  const valuation = data || {};
  const byCategory = valuation.by_category || [];
  const byLocation = valuation.by_location || [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Stock Value"
          value={formatCurrency(valuation.total_value || 0)}
          icon={DollarSign}
          variant="success"
        />
        <StatCard
          title="Total Items"
          value={formatNumber(valuation.total_items || 0)}
          icon={Package}
        />
        <StatCard
          title="Low Stock Value"
          value={formatCurrency(valuation.low_stock_value || 0)}
          icon={AlertTriangle}
          variant="warning"
        />
        <StatCard
          title="Expiring Value"
          value={formatCurrency(valuation.expiring_value || 0)}
          subtitle="Next 30 days"
          icon={AlertTriangle}
          variant="danger"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* By Category */}
        <Card className="bg-card/30 border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <PieChart className="h-5 w-5 text-sky-500" />
              Value by Category
            </CardTitle>
          </CardHeader>
          <CardContent>
            {byCategory.length > 0 ? (
              <div className="space-y-3">
                {byCategory.map((cat, index) => (
                  <div key={cat.id || index} className="flex items-center justify-between">
                    <span className="text-sm">{cat.name || cat.category}</span>
                    <div className="text-right">
                      <span className="font-mono text-sm font-semibold">
                        {formatCurrency(cat.value)}
                      </span>
                      <span className="text-xs text-muted-foreground ml-2">
                        ({formatPercent(cat.percentage)})
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">No data available</p>
            )}
          </CardContent>
        </Card>

        {/* By Location */}
        <Card className="bg-card/30 border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-5 w-5 text-emerald-500" />
              Value by Location
            </CardTitle>
          </CardHeader>
          <CardContent>
            {byLocation.length > 0 ? (
              <div className="space-y-3">
                {byLocation.map((loc, index) => (
                  <div key={loc.id || index} className="flex items-center justify-between">
                    <span className="text-sm">{loc.name || loc.location}</span>
                    <div className="text-right">
                      <span className="font-mono text-sm font-semibold">
                        {formatCurrency(loc.value)}
                      </span>
                      <span className="text-xs text-muted-foreground ml-2">
                        ({formatPercent(loc.percentage)})
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">No data available</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/**
 * AnalyticsPage - Inventory analytics dashboard
 */
export default function AnalyticsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'consumption';
  const period = searchParams.get('period') || '30d';

  const handleTabChange = (value) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set('tab', value);
      return params;
    });
  };

  const handlePeriodChange = (value) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set('period', value);
      return params;
    });
  };

  return (
    <PageShell>
      <PageHeader
        title="Inventory Analytics"
        description="Consumption trends, ABC analysis, and stock valuation"
        actions={(
          <Select value={period} onValueChange={handlePeriodChange}>
            <SelectTrigger className="w-[150px] font-mono text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIOD_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="font-mono text-sm">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />

      <div className="p-4 sm:p-6 space-y-6">

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="consumption" className="font-mono text-xs">
            <TrendingUp className="h-4 w-4 mr-2" />
            Consumption
          </TabsTrigger>
          <TabsTrigger value="abc" className="font-mono text-xs">
            <PieChart className="h-4 w-4 mr-2" />
            ABC Analysis
          </TabsTrigger>
          <TabsTrigger value="suppliers" className="font-mono text-xs">
            <Building2 className="h-4 w-4 mr-2" />
            Suppliers
          </TabsTrigger>
          <TabsTrigger value="valuation" className="font-mono text-xs">
            <DollarSign className="h-4 w-4 mr-2" />
            Valuation
          </TabsTrigger>
        </TabsList>

        <TabsContent value="consumption" className="mt-6">
          <ConsumptionTab period={period} />
        </TabsContent>

        <TabsContent value="abc" className="mt-6">
          <ABCAnalysisTab />
        </TabsContent>

        <TabsContent value="suppliers" className="mt-6">
          <SupplierTab period={period} />
        </TabsContent>

        <TabsContent value="valuation" className="mt-6">
          <ValuationTab />
        </TabsContent>
      </Tabs>
      </div>
    </PageShell>
  );
}
