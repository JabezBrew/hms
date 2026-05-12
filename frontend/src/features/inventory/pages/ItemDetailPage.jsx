import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageState } from '@/shared/components/page/PageState';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  StockLevelBadge,
  StockLevelIndicator,
  ExpiryBadge,
  InlineStockMovementTimeline,
} from '@/components/inventory';
import {
  useInventoryItem,
  useItemMovements,
  useItemExpiryTrackers,
  useItemStockByLocation,
} from '@/features/inventory/hooks';
import { format, parseISO } from 'date-fns';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.js';
import Edit from 'lucide-react/dist/esm/icons/pencil.js';
import MoreHorizontal from 'lucide-react/dist/esm/icons/more-horizontal.js';
import Package from 'lucide-react/dist/esm/icons/package.js';
import MapPin from 'lucide-react/dist/esm/icons/map-pin.js';
import Boxes from 'lucide-react/dist/esm/icons/boxes.js';
import Activity from 'lucide-react/dist/esm/icons/activity.js';
import ShoppingCart from 'lucide-react/dist/esm/icons/shopping-cart.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js';
import DollarSign from 'lucide-react/dist/esm/icons/dollar-sign.js';
import Tag from 'lucide-react/dist/esm/icons/tag.js';
import Building2 from 'lucide-react/dist/esm/icons/building-2.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';

/**
 * Format currency
 */
function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount || 0);
}

/**
 * Format number
 */
function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(value || 0);
}

/**
 * OverviewTab - Item overview information
 */
function OverviewTab({ item, isLoading }) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-card/30 border-border/50">
          <CardHeader className="pb-3">
            <Skeleton className="h-5 w-32" />
          </CardHeader>
          <CardContent className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex justify-between">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-32" />
              </div>
            ))}
          </CardContent>
        </Card>
        <Card className="bg-card/30 border-border/50">
          <CardHeader className="pb-3">
            <Skeleton className="h-5 w-32" />
          </CardHeader>
          <CardContent className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex justify-between">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-32" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Basic Information */}
      <Card className="bg-card/30 border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Package className="h-5 w-5 text-sky-500" />
            Basic Information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-between">
            <span className="text-sm text-muted-foreground">SKU</span>
            <span className="text-sm font-mono">{item.sku || '-'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-muted-foreground">Category</span>
            <span className="text-sm">{item.category_name || item.category || '-'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-muted-foreground">Unit of Measure</span>
            <span className="text-sm">{item.unit_of_measure || item.unit || '-'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-muted-foreground">Controlled</span>
            <Badge variant={item.is_controlled ? 'destructive' : 'secondary'}>
              {item.is_controlled ? 'Yes' : 'No'}
            </Badge>
          </div>
          {item.description && (
            <div className="pt-2 border-t border-border">
              <p className="text-sm text-muted-foreground mb-1">Description</p>
              <p className="text-sm">{item.description}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pricing & Reorder */}
      <Card className="bg-card/30 border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <DollarSign className="h-5 w-5 text-emerald-500" />
            Pricing & Reorder
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-between">
            <span className="text-sm text-muted-foreground">Unit Price</span>
            <span className="text-sm font-mono font-semibold">
              {formatCurrency(item.unit_price)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-muted-foreground">Reorder Level</span>
            <span className="text-sm font-mono">{formatNumber(item.reorder_level)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-muted-foreground">Reorder Quantity</span>
            <span className="text-sm font-mono">{formatNumber(item.reorder_quantity)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-muted-foreground">Max Stock</span>
            <span className="text-sm font-mono">{formatNumber(item.max_stock_level)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-muted-foreground">Total Stock Value</span>
            <span className="text-sm font-mono font-semibold text-emerald-500">
              {formatCurrency((item.total_stock || 0) * (item.unit_price || 0))}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Supplier Information */}
      {item.supplier_name && (
        <Card className="bg-card/30 border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-5 w-5 text-amber-500" />
              Supplier
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Name</span>
              <span className="text-sm">{item.supplier_name}</span>
            </div>
            {item.supplier_code && (
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Supplier Code</span>
                <span className="text-sm font-mono">{item.supplier_code}</span>
              </div>
            )}
            {item.lead_time_days && (
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Lead Time</span>
                <span className="text-sm">{item.lead_time_days} days</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Metadata */}
      <Card className="bg-card/30 border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-5 w-5 text-muted-foreground" />
            Activity
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {item.created_at && (
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Created</span>
              <span className="text-sm font-mono">
                {format(parseISO(item.created_at), 'MMM d, yyyy')}
              </span>
            </div>
          )}
          {item.updated_at && (
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Last Updated</span>
              <span className="text-sm font-mono">
                {format(parseISO(item.updated_at), 'MMM d, yyyy HH:mm')}
              </span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-sm text-muted-foreground">Status</span>
            <Badge variant={item.is_active !== false ? 'default' : 'secondary'}>
              {item.is_active !== false ? 'Active' : 'Inactive'}
            </Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * StockByLocationTab - Stock levels across locations
 */
function StockByLocationTab({ itemId }) {
  const { data: stockData, isLoading } = useItemStockByLocation(itemId);

  const locations = stockData?.results || stockData || [];

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (!locations.length) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <MapPin className="h-10 w-10 text-muted-foreground/50 mb-3" />
        <p className="text-sm text-muted-foreground">
          No stock at any location
        </p>
      </div>
    );
  }

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <table className="w-full">
        <thead className="bg-muted/50 border-b border-border">
          <tr>
            <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">
              Location
            </th>
            <th className="text-right px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">
              Available
            </th>
            <th className="text-right px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">
              Reserved
            </th>
            <th className="text-right px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">
              Total
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {locations.map((loc) => (
            <tr key={loc.id || loc.location_id} className="hover:bg-muted/30 transition-colors">
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">{loc.location_name || loc.name}</span>
                  {loc.location_type && (
                    <Badge variant="outline" className="text-xs">
                      {loc.location_type}
                    </Badge>
                  )}
                </div>
              </td>
              <td className="px-4 py-3 text-right font-mono text-sm">
                {formatNumber(loc.available_quantity || loc.quantity || 0)}
              </td>
              <td className="px-4 py-3 text-right font-mono text-sm text-muted-foreground">
                {formatNumber(loc.reserved_quantity || 0)}
              </td>
              <td className="px-4 py-3 text-right font-mono text-sm font-semibold">
                {formatNumber((loc.available_quantity || loc.quantity || 0) + (loc.reserved_quantity || 0))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * BatchesTab - Expiry tracking for batches
 */
function BatchesTab({ itemId }) {
  const { data: batchesData, isLoading } = useItemExpiryTrackers(itemId);

  const batches = batchesData?.results || batchesData || [];

  // Sort by expiry date (FEFO)
  const sortedBatches = [...batches].sort((a, b) => {
    const dateA = a.expiry_date ? parseISO(a.expiry_date) : new Date('9999-12-31');
    const dateB = b.expiry_date ? parseISO(b.expiry_date) : new Date('9999-12-31');
    return dateA - dateB;
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  if (!batches.length) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Boxes className="h-10 w-10 text-muted-foreground/50 mb-3" />
        <p className="text-sm text-muted-foreground">
          No batches tracked
        </p>
      </div>
    );
  }

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <table className="w-full">
        <thead className="bg-muted/50 border-b border-border">
          <tr>
            <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">
              Batch Number
            </th>
            <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">
              Location
            </th>
            <th className="text-right px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">
              Quantity
            </th>
            <th className="text-center px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">
              Expiry Date
            </th>
            <th className="text-center px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">
              Status
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {sortedBatches.map((batch, index) => (
            <tr
              key={batch.batch_id || batch.id || index}
              className={cn(
                'hover:bg-muted/30 transition-colors',
                index === 0 && 'bg-emerald-500/5' // Highlight first (FEFO recommended)
              )}
            >
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono">{batch.batch_number || '-'}</span>
                  {index === 0 && (
                    <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-600 border-emerald-500/30">
                      FEFO
                    </Badge>
                  )}
                </div>
              </td>
              <td className="px-4 py-3">
                <span className="text-sm text-muted-foreground">
                  {batch.location_name || '-'}
                </span>
              </td>
              <td className="px-4 py-3 text-right font-mono text-sm">
                {formatNumber(batch.quantity)}
              </td>
              <td className="px-4 py-3 text-center">
                {batch.expiry_date ? (
                  <span className="text-sm font-mono">
                    {format(parseISO(batch.expiry_date), 'MMM d, yyyy')}
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground">-</span>
                )}
              </td>
              <td className="px-4 py-3 text-center">
                {batch.expiry_date && <ExpiryBadge expiryDate={batch.expiry_date} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * MovementsTab - Stock movement history
 */
function MovementsTab({ itemId }) {
  const { data: movementsData, isLoading } = useItemMovements(itemId, { page_size: 50 });

  const movements = movementsData?.results || movementsData || [];

  return (
    <InlineStockMovementTimeline
      movements={movements}
      isLoading={isLoading}
      showLocation={true}
    />
  );
}

/**
 * OrdersTab - Related purchase orders and requisitions
 */
function OrdersTab({ itemId, navigate }) {
  // This would typically fetch related orders
  // For now, showing a placeholder
  return (
    <div className="space-y-6">
      <Card className="bg-card/30 border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-5 w-5 text-amber-500" />
            Purchase Orders
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <FileText className="h-10 w-10 text-muted-foreground/50 mb-3" />
            <p className="text-sm text-muted-foreground mb-3">
              No recent purchase orders for this item
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(`/inventory/requisitions?action=create&items=${itemId}`)}
            >
              <ShoppingCart className="h-4 w-4 mr-2" />
              Create Requisition
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * ItemDetailPage - Item detail view with tabs
 */
export default function ItemDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const activeTab = searchParams.get('tab') || 'overview';

  const { data: item, isLoading, error, refetch } = useInventoryItem(id);

  const handleTabChange = (value) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set('tab', value);
      return params;
    });
  };

  const handleBack = () => {
    navigate('/inventory/items');
  };

  const handleEdit = () => {
    navigate(`/inventory/items/${id}?action=edit`);
  };

  const handleCreateRequisition = () => {
    navigate(`/inventory/requisitions?action=create&items=${id}`);
  };

  // Loading state
  if (isLoading) {
    return (
      <PageState variant="loading" fullHeight={false} className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10" />
          <div>
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-5 w-48 mt-2" />
          </div>
        </div>
        <Skeleton className="h-10 w-full max-w-md" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </PageState>
    );
  }

  // Error state
  if (error) {
    return (
      <PageState
        variant="error"
        title="Error Loading Item"
        description={error.message}
        action={(
          <div className="flex items-center justify-center gap-2">
            <Button variant="outline" onClick={handleBack}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Items
            </Button>
            <Button onClick={() => refetch()} className="font-mono text-xs">
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </div>
        )}
      />
    );
  }

  // Not found
  if (!item) {
    return (
      <PageState
        variant="empty"
        title="Item Not Found"
        description="The requested item does not exist or has been deleted."
        action={(
          <Button variant="outline" onClick={handleBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Items
          </Button>
        )}
      />
    );
  }

  return (
    <PageShell>
      <PageHeader
        title={(
          <span className="flex items-center gap-3">
            <span className="truncate">{item.name}</span>
            {item.is_controlled && (
              <Badge variant="destructive">Controlled</Badge>
            )}
          </span>
        )}
        description={(
          <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Tag className="h-4 w-4" />
              <span className="font-mono text-sm">{item.sku || 'No SKU'}</span>
            </span>
            {item.category_name && (
              <span className="flex items-center gap-1.5">
                <Package className="h-4 w-4" />
                <span className="text-sm">{item.category_name}</span>
              </span>
            )}
            {item.unit_of_measure && (
              <span className="text-sm">Unit: {item.unit_of_measure}</span>
            )}
          </div>
        )}
        actions={(
          <div className="flex items-center gap-2 shrink-0">
            <StockLevelBadge
              stockLevel={item.total_stock || 0}
              reorderLevel={item.reorder_level}
              showQuantity={true}
              size="lg"
            />
            <Button variant="outline" onClick={handleEdit}>
              <Edit className="h-4 w-4 mr-2" />
              Edit
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleCreateRequisition}>
                  <ShoppingCart className="h-4 w-4 mr-2" />
                  Create Requisition
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => refetch()}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Refresh
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      >
        <Button
          variant="ghost"
          size="sm"
          className="w-fit -ml-2"
          onClick={handleBack}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Items
        </Button>
      </PageHeader>

      <div className="p-4 sm:p-6 space-y-6">

      {/* Stock Summary Bar */}
      <div className="bg-card/30 border border-border rounded-lg p-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Total Stock</p>
            <p className="text-2xl font-mono font-semibold">
              {formatNumber(item.total_stock || 0)}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Reorder Level</p>
            <p className="text-2xl font-mono font-semibold">
              {formatNumber(item.reorder_level || 0)}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Unit Price</p>
            <p className="text-2xl font-mono font-semibold text-emerald-500">
              {formatCurrency(item.unit_price)}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Stock Value</p>
            <p className="text-2xl font-mono font-semibold text-emerald-500">
              {formatCurrency((item.total_stock || 0) * (item.unit_price || 0))}
            </p>
          </div>
        </div>
        <div className="mt-4">
          <StockLevelIndicator
            stockLevel={item.total_stock || 0}
            reorderLevel={item.reorder_level}
            maxStock={item.max_stock_level}
          />
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="overview" className="font-mono text-xs">
            <Package className="h-4 w-4 mr-2" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="locations" className="font-mono text-xs">
            <MapPin className="h-4 w-4 mr-2" />
            Stock by Location
          </TabsTrigger>
          <TabsTrigger value="batches" className="font-mono text-xs">
            <Boxes className="h-4 w-4 mr-2" />
            Batches
          </TabsTrigger>
          <TabsTrigger value="movements" className="font-mono text-xs">
            <Activity className="h-4 w-4 mr-2" />
            Movements
          </TabsTrigger>
          <TabsTrigger value="orders" className="font-mono text-xs">
            <ShoppingCart className="h-4 w-4 mr-2" />
            Orders
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          <OverviewTab item={item} isLoading={isLoading} />
        </TabsContent>

        <TabsContent value="locations" className="mt-6">
          <StockByLocationTab itemId={id} />
        </TabsContent>

        <TabsContent value="batches" className="mt-6">
          <BatchesTab itemId={id} />
        </TabsContent>

        <TabsContent value="movements" className="mt-6">
          <MovementsTab itemId={id} />
        </TabsContent>

        <TabsContent value="orders" className="mt-6">
          <OrdersTab itemId={id} navigate={navigate} />
        </TabsContent>
      </Tabs>
      </div>
    </PageShell>
  );
}
