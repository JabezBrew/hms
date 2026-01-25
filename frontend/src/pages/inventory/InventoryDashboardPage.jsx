import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  InventoryStatsRow,
  LowStockAlert,
  ExpiringItemsWidget,
} from '@/components/inventory';
import {
  useInventoryDashboardMetrics,
  useLowStockAlerts,
  useExpiringItems,
} from '@/hooks/useInventoryQueries';
import { cn } from '@/lib/utils';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import FileBox from 'lucide-react/dist/esm/icons/file-box.js';
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle.js';
import Activity from 'lucide-react/dist/esm/icons/activity.js';
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right.js';
import ShoppingCart from 'lucide-react/dist/esm/icons/shopping-cart.js';
import Package from 'lucide-react/dist/esm/icons/package.js';

/**
 * PendingActionsWidget - Shows pending actions requiring attention
 */
function PendingActionsWidget({ isLoading, metrics, className }) {
  const navigate = useNavigate();

  // Use real data from metrics, default to 0
  const pendingActions = {
    requisitions_pending: metrics?.pending_requisitions || 0,
    grns_to_inspect: metrics?.pending_grns || 0,
    discrepancies: metrics?.discrepancies || 0,
  };

  if (isLoading) {
    return (
      <Card className={cn('bg-card/30 border-border/50', className)}>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  const actions = [
    {
      label: 'Requisitions pending approval',
      count: pendingActions.requisitions_pending,
      icon: ClipboardList,
      href: '/inventory/requisitions?status=pending',
      variant: 'warning',
    },
    {
      label: 'GRNs to inspect',
      count: pendingActions.grns_to_inspect,
      icon: FileBox,
      href: '/inventory/grns?status=pending_inspection',
      variant: 'default',
    },
    {
      label: 'Discrepancies to resolve',
      count: pendingActions.discrepancies,
      icon: AlertCircle,
      href: '/inventory/controlled?tab=discrepancies',
      variant: 'danger',
    },
  ].filter(action => action.count > 0);

  return (
    <Card className={cn('bg-card/30 border-border/50', className)}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardList className="h-5 w-5 text-amber-500" />
          Pending Actions
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {actions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Package className="h-10 w-10 text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground">
              No pending actions
            </p>
          </div>
        ) : (
          actions.map((action, index) => (
            <div
              key={index}
              className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
              onClick={() => navigate(action.href)}
            >
              <div className="flex items-center gap-3">
                <action.icon className={cn(
                  'h-5 w-5',
                  action.variant === 'warning' && 'text-amber-500',
                  action.variant === 'danger' && 'text-rose-500',
                  action.variant === 'default' && 'text-muted-foreground'
                )} />
                <span className="text-sm">{action.label}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={cn(
                  'font-mono text-lg font-semibold',
                  action.variant === 'warning' && 'text-amber-500',
                  action.variant === 'danger' && 'text-rose-500'
                )}>
                  {action.count}
                </span>
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

/**
 * RecentActivityWidget - Shows recent inventory activity
 */
function RecentActivityWidget({ isLoading, activities = [], className }) {
  // Use real activity data passed from parent
  const recentActivity = activities;

  if (isLoading) {
    return (
      <Card className={cn('bg-card/30 border-border/50', className)}>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-start gap-3">
              <Skeleton className="h-2 w-2 rounded-full mt-2" />
              <div className="space-y-1 flex-1">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn('bg-card/30 border-border/50', className)}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-5 w-5 text-sky-500" />
          Recent Activity
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {recentActivity.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Activity className="h-10 w-10 text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground">
              No recent activity
            </p>
          </div>
        ) : (
          recentActivity.map((activity) => (
            <div key={activity.id} className="flex items-start gap-3">
              <div className="mt-1.5">
                <div className="h-2 w-2 rounded-full bg-sky-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate">{activity.description}</p>
                <p className="text-xs text-muted-foreground font-mono">
                  {activity.timestamp}
                </p>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

/**
 * QuickActionsWidget - Quick action buttons
 */
function QuickActionsWidget({ className }) {
  const navigate = useNavigate();

  const quickActions = [
    {
      label: 'Add Item',
      icon: Plus,
      href: '/inventory/items?action=create',
      variant: 'default',
    },
    {
      label: 'Create Requisition',
      icon: ShoppingCart,
      href: '/inventory/requisitions?action=create',
      variant: 'outline',
    },
    {
      label: 'Record Count',
      icon: ClipboardList,
      href: '/inventory/controlled?action=count',
      variant: 'outline',
    },
  ];

  return (
    <Card className={cn('bg-card/30 border-border/50', className)}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Quick Actions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {quickActions.map((action, index) => (
          <Button
            key={index}
            variant={action.variant}
            className="w-full justify-start"
            onClick={() => navigate(action.href)}
          >
            <action.icon className="h-4 w-4 mr-2" />
            {action.label}
          </Button>
        ))}
      </CardContent>
    </Card>
  );
}

/**
 * InventoryDashboardPage - Main inventory dashboard
 */
export default function InventoryDashboardPage() {
  const navigate = useNavigate();

  // Fetch dashboard data
  const {
    data: metrics,
    isLoading: metricsLoading,
    refetch: refetchMetrics,
  } = useInventoryDashboardMetrics();

  const {
    data: lowStockItems,
    isLoading: lowStockLoading,
  } = useLowStockAlerts({ limit: 10 });

  const {
    data: expiringItems,
    isLoading: expiringLoading,
  } = useExpiringItems({ days: 30, limit: 10 });

  const isLoading = metricsLoading;

  const handleRefresh = () => {
    refetchMetrics();
  };

  const handleCreateRequisition = (items) => {
    // Navigate to requisition creation with pre-selected items
    const itemIds = items.map(item => item.id).join(',');
    navigate(`/inventory/requisitions?action=create&items=${itemIds}`);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold">
            Inventory Dashboard
          </h1>
          <p className="text-muted-foreground mt-1">
            Monitor stock levels, manage procurement, and track inventory health
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleRefresh}>
            <RefreshCw className={cn('h-4 w-4 mr-2', isLoading && 'animate-spin')} />
            Refresh
          </Button>
          <Button onClick={() => navigate('/inventory/items?action=create')}>
            <Plus className="h-4 w-4 mr-2" />
            Add Item
          </Button>
        </div>
      </div>

      {/* Stats Row */}
      <InventoryStatsRow stats={metrics} isLoading={metricsLoading} />

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Alerts */}
        <div className="lg:col-span-2 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <LowStockAlert
              items={lowStockItems?.results || lowStockItems || []}
              limit={5}
              isLoading={lowStockLoading}
              onCreateRequisition={handleCreateRequisition}
            />
            <ExpiringItemsWidget
              items={expiringItems?.results || expiringItems || []}
              limit={5}
              isLoading={expiringLoading}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <PendingActionsWidget isLoading={isLoading} metrics={metrics} />
            <RecentActivityWidget isLoading={isLoading} activities={[]} />
          </div>
        </div>

        {/* Right Column - Quick Actions */}
        <div className="space-y-6">
          <QuickActionsWidget />
        </div>
      </div>
    </div>
  );
}
