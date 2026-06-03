import { useState, useMemo, useCallback, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import VirtualizedTable from '@/components/ui/VirtualizedTable';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageState } from '@/shared/components/page/PageState';
import { InventoryPagination } from '@/features/inventory/components/InventoryPagination';
import { useStandingOrders } from '@/features/inventory/hooks';
import { useDebounce } from '@/hooks/use-debounce';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { format, parseISO } from 'date-fns';
import Search from 'lucide-react/dist/esm/icons/search.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import Repeat from 'lucide-react/dist/esm/icons/repeat.js';
import X from 'lucide-react/dist/esm/icons/x.js';

const FREQUENCY_CONFIG = {
  daily: { label: 'Daily', color: 'text-sky-500', bgColor: 'bg-sky-500/10' },
  weekly: { label: 'Weekly', color: 'text-emerald-500', bgColor: 'bg-emerald-500/10' },
  biweekly: { label: 'Bi-weekly', color: 'text-amber-500', bgColor: 'bg-amber-500/10' },
  monthly: { label: 'Monthly', color: 'text-violet-500', bgColor: 'bg-violet-500/10' },
};

function getFrequencyConfig(frequency) {
  return FREQUENCY_CONFIG[frequency?.toLowerCase()] || { label: frequency || 'Custom', color: 'text-muted-foreground', bgColor: 'bg-muted' };
}

function useStandingOrderFilters() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlSearch = searchParams.get('search') || '';
  const [search, setSearch] = useState(urlSearch);
  const showInactive = searchParams.get('show_inactive') === 'true';
  const page = parseInt(searchParams.get('page') || '1', 10);
  const debouncedSearch = useDebounce(search, 300);

  useEffect(() => {
    setSearch((current) => (current === urlSearch ? current : urlSearch));
  }, [urlSearch]);

  const handleToggleInactive = useCallback(() => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (showInactive) {
        params.delete('show_inactive');
      } else {
        params.set('show_inactive', 'true');
      }
      params.set('page', '1');
      return params;
    });
  }, [setSearchParams, showInactive]);

  const handlePageChange = useCallback((newPage) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set('page', newPage.toString());
      return params;
    });
  }, [setSearchParams]);

  const clearFilters = useCallback(() => {
    setSearch('');
    setSearchParams({});
  }, [setSearchParams]);

  const handleSearchChange = useCallback((event) => {
    const value = event.target.value;
    setSearch(value);
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (value) {
        params.set('search', value);
      } else {
        params.delete('search');
      }
      params.set('page', '1');
      return params;
    });
  }, [setSearchParams]);

  const queryParams = useMemo(() => ({
    page,
    page_size: 20,
    ...(debouncedSearch && { search: debouncedSearch }),
    ...(!showInactive && { is_active: true }),
  }), [debouncedSearch, page, showInactive]);

  return {
    search,
    showInactive,
    page,
    queryParams,
    hasActiveFilters: Boolean(debouncedSearch || showInactive),
    handleSearchChange,
    handleToggleInactive,
    handlePageChange,
    clearFilters,
  };
}

function createStandingOrderColumns({ standingOrderManagementAvailable, onEdit, onGenerate }) {
  const columns = [
    {
      key: 'name',
      header: 'Template',
      width: '260px',
      render: (order) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{order.name || order.order_number}</p>
          <p className="truncate text-xs text-muted-foreground">{order.requesting_location_name || 'No location'}</p>
        </div>
      ),
    },
    {
      key: 'frequency',
      header: 'Frequency',
      width: '140px',
      render: (order) => {
        const frequencyConfig = getFrequencyConfig(order.frequency);
        return (
          <Badge variant="outline" className={cn('text-xs', frequencyConfig.bgColor, frequencyConfig.color)}>
            {frequencyConfig.label}
          </Badge>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      width: '120px',
      render: (order) => (
        <Badge
          variant="outline"
          className={order.is_active ? 'border-emerald-200 bg-emerald-50 text-emerald-700 text-xs' : 'text-xs'}
        >
          {order.is_active ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      key: 'next_due',
      header: 'Next Due',
      width: '160px',
      render: (order) => (
        <span className="font-mono text-sm text-muted-foreground">
          {order.next_due_date ? format(parseISO(order.next_due_date), 'MMM d, yyyy') : '-'}
        </span>
      ),
    },
    {
      key: 'items',
      header: 'Items',
      width: '100px',
      render: (order) => <span className="font-mono text-sm text-muted-foreground">{order.items_count || 0}</span>,
    },
  ];

  if (!standingOrderManagementAvailable) {
    return columns;
  }

  return [
    ...columns,
    {
      key: 'actions',
      header: '',
      width: '180px',
      render: (order) => (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs"
            onClick={(event) => { event.stopPropagation(); onEdit(order.id); }}
          >
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs"
            onClick={(event) => { event.stopPropagation(); onGenerate(order.id); }}
          >
            Generate
          </Button>
        </div>
      ),
    },
  ];
}

function StandingOrdersLoadingState() {
  return (
    <PageState variant="loading" fullHeight={false} className="space-y-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-10 w-40" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="bg-card/30 border border-border/50 rounded-lg p-4">
            <Skeleton className="h-4 w-32 mb-3" />
            <div className="flex gap-2 mb-3">
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-5 w-16" />
            </div>
            <Skeleton className="h-4 w-full mb-2" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ))}
      </div>
    </PageState>
  );
}

function StandingOrdersHeader({
  totalCount,
  isLoading,
  standingOrderManagementAvailable,
  onRefresh,
  onCreate,
}) {
  return (
    <PageHeader
      title="Standing Orders"
      description={`${totalCount} template${totalCount !== 1 ? 's' : ''}`}
      actions={(
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onRefresh}>
            {isLoading ? (
              <LoadingSpinner className="mr-2 h-4 w-8" />
            ) : (
              <RefreshCw className="size-4 mr-2" />
            )}
            Refresh
          </Button>
          {standingOrderManagementAvailable && (
            <Button onClick={onCreate}>
              <Plus className="size-4 mr-2" />
              New Template
            </Button>
          )}
        </div>
      )}
    />
  );
}

function StandingOrderManagementNotice({ standingOrderManagementAvailable }) {
  if (standingOrderManagementAvailable) {
    return null;
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      Standing order template management is not available in Rust V2 mode yet. Existing
      template review remains visible, but creation, editing, and generation require a
      generated /api/v2 standing-order contract.
    </div>
  );
}

function StandingOrdersFilters({
  search,
  showInactive,
  hasActiveFilters,
  onSearchChange,
  onToggleInactive,
  onClearFilters,
}) {
  return (
    <div className="flex flex-col lg:flex-row gap-3 items-start lg:items-center">
      <div className="relative flex-1 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder="Search templates..."
          value={search}
          onChange={onSearchChange}
          className="pl-9 font-mono text-sm"
        />
      </div>

      <div className="flex items-center gap-2">
        <Switch
          id="show-inactive"
          checked={showInactive}
          onCheckedChange={onToggleInactive}
        />
        <label htmlFor="show-inactive" className="text-sm text-muted-foreground cursor-pointer">
          Show inactive
        </label>
      </div>

      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={onClearFilters} className="text-muted-foreground">
          <X className="size-4 mr-1" />
          Clear
        </Button>
      )}
    </div>
  );
}

function StandingOrdersTable({ orders, columns, onOpenOrder }) {
  return (
    <div className="overflow-x-auto">
      <VirtualizedTable
        rows={orders}
        rowKey={(order) => order.id}
        rowHeight={68}
        columns={columns}
        onRowClick={(order) => onOpenOrder(order.id)}
        rowClassName="hover:bg-muted/30"
        className="min-w-[980px]"
        headerClassName="bg-muted/50 border-b border-border"
      />
    </div>
  );
}

function StandingOrdersEmptyState({
  hasActiveFilters,
  standingOrderManagementAvailable,
  onCreate,
}) {
  return (
    <div className="bg-card/50 border rounded-2xl p-12 text-center">
      <Repeat className="size-10 text-muted-foreground/50 mx-auto mb-3" />
      <h3 className="font-display text-xl mb-2">No Standing Orders Found</h3>
      <p className="text-muted-foreground text-sm mb-4">
        {hasActiveFilters
          ? 'Try adjusting your filters'
          : 'Create a template for recurring requisitions'}
      </p>
      {!hasActiveFilters && standingOrderManagementAvailable && (
        <Button onClick={onCreate}>
          <Plus className="size-4 mr-2" />
          New Template
        </Button>
      )}
    </div>
  );
}

function StandingOrdersDisplay({
  orders,
  columns,
  hasActiveFilters,
  standingOrderManagementAvailable,
  onOpenOrder,
  onCreate,
}) {
  if (orders.length === 0) {
    return (
      <StandingOrdersEmptyState
        hasActiveFilters={hasActiveFilters}
        standingOrderManagementAvailable={standingOrderManagementAvailable}
        onCreate={onCreate}
      />
    );
  }

  return (
    <StandingOrdersTable
      orders={orders}
      columns={columns}
      onOpenOrder={onOpenOrder}
    />
  );
}

/**
 * StandingOrdersPage - Recurring order templates page
 */
export default function StandingOrdersPage() {
  const navigate = useNavigate();
  const rustV2Mode = isRustV2ApiMode();
  const standingOrderManagementAvailable = !rustV2Mode;
  const {
    search,
    showInactive,
    page,
    queryParams,
    hasActiveFilters,
    handleSearchChange,
    handleToggleInactive,
    handlePageChange,
    clearFilters,
  } = useStandingOrderFilters();
  const { data: ordersData, isLoading, error, refetch } = useStandingOrders(queryParams);
  const orders = ordersData?.results || [];
  const totalCount = ordersData?.count || 0;

  const handleClick = useCallback((id) => {
    navigate(`/inventory/standing-orders/${id}`);
  }, [navigate]);
  const handleEdit = useCallback((id) => {
    if (standingOrderManagementAvailable) {
      navigate(`/inventory/standing-orders/${id}?action=edit`);
    }
  }, [navigate, standingOrderManagementAvailable]);
  const handleGenerate = useCallback((id) => {
    if (standingOrderManagementAvailable) {
      navigate(`/inventory/standing-orders/${id}?action=generate`);
    }
  }, [navigate, standingOrderManagementAvailable]);
  const handleCreate = useCallback(() => {
    if (standingOrderManagementAvailable) {
      navigate('/inventory/standing-orders?action=create');
    }
  }, [navigate, standingOrderManagementAvailable]);
  const orderColumns = useMemo(() => createStandingOrderColumns({
    standingOrderManagementAvailable,
    onEdit: handleEdit,
    onGenerate: handleGenerate,
  }), [handleEdit, handleGenerate, standingOrderManagementAvailable]);

  if (isLoading) {
    return <StandingOrdersLoadingState />;
  }

  if (error) {
    return (
      <PageState
        variant="error"
        title="Error Loading Standing Orders"
        description={error.message}
        action={() => refetch()}
      />
    );
  }

  return (
    <PageShell>
      <StandingOrdersHeader
        totalCount={totalCount}
        isLoading={isLoading}
        standingOrderManagementAvailable={standingOrderManagementAvailable}
        onRefresh={refetch}
        onCreate={handleCreate}
      />

      <div className="p-4 sm:p-6 space-y-6">
        <StandingOrderManagementNotice standingOrderManagementAvailable={standingOrderManagementAvailable} />

        <StandingOrdersFilters
          search={search}
          showInactive={showInactive}
          hasActiveFilters={hasActiveFilters}
          onSearchChange={handleSearchChange}
          onToggleInactive={handleToggleInactive}
          onClearFilters={clearFilters}
        />

        <StandingOrdersDisplay
          orders={orders}
          columns={orderColumns}
          hasActiveFilters={hasActiveFilters}
          standingOrderManagementAvailable={standingOrderManagementAvailable}
          onOpenOrder={handleClick}
          onCreate={handleCreate}
        />

        <InventoryPagination
          data={ordersData}
          itemLabel="standing orders"
          page={page}
          pageSize={20}
          onPageChange={handlePageChange}
        />
      </div>
    </PageShell>
  );
}
