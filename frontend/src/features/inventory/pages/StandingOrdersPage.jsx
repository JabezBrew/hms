import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import VirtualizedTable from '@/components/ui/VirtualizedTable';
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
import { useStandingOrders } from '@/features/inventory/hooks';
import { useDebounce } from '@/hooks/use-debounce';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { format, parseISO } from 'date-fns';
import Search from 'lucide-react/dist/esm/icons/search.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import Repeat from 'lucide-react/dist/esm/icons/repeat.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import MoreHorizontal from 'lucide-react/dist/esm/icons/more-horizontal.js';
import Eye from 'lucide-react/dist/esm/icons/eye.js';
import Edit from 'lucide-react/dist/esm/icons/pencil.js';
import Play from 'lucide-react/dist/esm/icons/play.js';
import Pause from 'lucide-react/dist/esm/icons/pause.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import MapPin from 'lucide-react/dist/esm/icons/map-pin.js';
import Clock from 'lucide-react/dist/esm/icons/clock.js';

const FREQUENCY_CONFIG = {
  daily: { label: 'Daily', color: 'text-sky-500', bgColor: 'bg-sky-500/10' },
  weekly: { label: 'Weekly', color: 'text-emerald-500', bgColor: 'bg-emerald-500/10' },
  biweekly: { label: 'Bi-weekly', color: 'text-amber-500', bgColor: 'bg-amber-500/10' },
  monthly: { label: 'Monthly', color: 'text-violet-500', bgColor: 'bg-violet-500/10' },
};

function getFrequencyConfig(frequency) {
  return FREQUENCY_CONFIG[frequency?.toLowerCase()] || { label: frequency || 'Custom', color: 'text-muted-foreground', bgColor: 'bg-muted' };
}

/**
 * StandingOrderCard - Card display for standing orders
 */
function StandingOrderCard({
  order,
  index = 0,
  onClick,
  onEdit,
  onGenerate,
  onToggleActive,
}) {
  const frequencyConfig = getFrequencyConfig(order.frequency);

  return (
    <Card
      className={cn(
        'group relative bg-card/30 border-border/50',
        'hover:border-primary/30 hover:shadow-[0_0_20px_-8px_var(--chronicle-amber)]',
        'transition-all duration-300 cursor-pointer',
        'animate-chronicle-enter',
        !order.is_active && 'opacity-60'
      )}
      style={{ animationDelay: `${index * 50}ms` }}
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <Repeat className="h-4 w-4 text-muted-foreground" />
            <span className="font-mono text-sm font-medium text-primary">
              {order.name || order.order_number}
            </span>
          </div>

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
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onClick?.(); }}>
                <Eye className="h-4 w-4 mr-2" />
                View Details
              </DropdownMenuItem>
              {onEdit && (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEdit(); }}>
                  <Edit className="h-4 w-4 mr-2" />
                  Edit Template
                </DropdownMenuItem>
              )}
              {order.is_active && onGenerate && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onGenerate(); }}>
                    <Play className="h-4 w-4 mr-2" />
                    Generate Now
                  </DropdownMenuItem>
                </>
              )}
              {onToggleActive && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onToggleActive(); }}>
                    {order.is_active ? (
                      <>
                        <Pause className="h-4 w-4 mr-2" />
                        Deactivate
                      </>
                    ) : (
                      <>
                        <Play className="h-4 w-4 mr-2" />
                        Activate
                      </>
                    )}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center gap-2 mb-3">
          <Badge
            variant="outline"
            className={cn('text-xs', frequencyConfig.bgColor, frequencyConfig.color)}
          >
            {frequencyConfig.label}
          </Badge>
          <Badge
            variant="outline"
            className={cn(
              'text-xs',
              order.is_active
                ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30'
                : 'bg-muted text-muted-foreground'
            )}
          >
            {order.is_active ? 'Active' : 'Inactive'}
          </Badge>
        </div>

        <div className="space-y-2 mb-3">
          {order.requesting_location_name && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <MapPin className="h-3 w-3" />
              <span>{order.requesting_location_name}</span>
            </div>
          )}
          {order.next_due_date && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Calendar className="h-3 w-3" />
              <span>
                Next: <span className="font-mono">{format(parseISO(order.next_due_date), 'MMM d, yyyy')}</span>
              </span>
            </div>
          )}
          {order.last_generated_at && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span>
                Last: <span className="font-mono">{format(parseISO(order.last_generated_at), 'MMM d, yyyy')}</span>
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-border">
          <div className="text-xs text-muted-foreground">
            {order.items_count || 0} item{(order.items_count || 0) !== 1 ? 's' : ''}
          </div>
          {order.generated_count !== undefined && (
            <div className="text-xs text-muted-foreground">
              {order.generated_count} generated
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * StandingOrdersPage - Recurring order templates page
 */
export default function StandingOrdersPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const standingOrderManagementAvailable = !isRustV2ApiMode();

  const [search, setSearch] = useState(searchParams.get('search') || '');
  const showInactive = searchParams.get('show_inactive') === 'true';
  const page = parseInt(searchParams.get('page') || '1', 10);

  const debouncedSearch = useDebounce(search, 300);

  const queryParams = {
    page,
    page_size: 20,
    ...(debouncedSearch && { search: debouncedSearch }),
    ...(!showInactive && { is_active: true }),
  };

  const { data: ordersData, isLoading, error, refetch } = useStandingOrders(queryParams);

  const orders = ordersData?.results || [];
  const totalCount = ordersData?.count || 0;
  const totalPages = Math.ceil(totalCount / 20);

  const handleSearchChange = (e) => setSearch(e.target.value);

  useEffect(() => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (debouncedSearch) {
        params.set('search', debouncedSearch);
      } else {
        params.delete('search');
      }
      params.set('page', '1');
      return params;
    });
  }, [debouncedSearch, setSearchParams]);

  const handleToggleInactive = () => {
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
  };

  const handlePageChange = (newPage) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set('page', newPage.toString());
      return params;
    });
  };

  const clearFilters = () => {
    setSearch('');
    setSearchParams({});
  };

  const hasActiveFilters = debouncedSearch || showInactive;

  const handleClick = (id) => navigate(`/inventory/standing-orders/${id}`);
  const handleEdit = (id) => {
    if (!standingOrderManagementAvailable) {
      return;
    }
    navigate(`/inventory/standing-orders/${id}?action=edit`);
  };
  const handleGenerate = (id) => {
    if (!standingOrderManagementAvailable) {
      return;
    }
    navigate(`/inventory/standing-orders/${id}?action=generate`);
  };
  const handleCreate = () => {
    if (!standingOrderManagementAvailable) {
      return;
    }
    navigate('/inventory/standing-orders?action=create');
  };

  const orderColumns = [
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
        return <Badge variant="outline" className={cn('text-xs', frequencyConfig.bgColor, frequencyConfig.color)}>{frequencyConfig.label}</Badge>;
      },
    },
    {
      key: 'status',
      header: 'Status',
      width: '120px',
      render: (order) => (
        <Badge variant="outline" className={order.is_active ? 'border-emerald-200 bg-emerald-50 text-emerald-700 text-xs' : 'text-xs'}>
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
          {order.next_due_date ? format(parseISO(order.next_due_date), 'MMM d, yyyy') : '—'}
        </span>
      ),
    },
    {
      key: 'items',
      header: 'Items',
      width: '100px',
      render: (order) => <span className="font-mono text-sm text-muted-foreground">{order.items_count || 0}</span>,
    },
    ...(standingOrderManagementAvailable
      ? [{
          key: 'actions',
          header: '',
          width: '180px',
          render: (order) => (
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={(event) => { event.stopPropagation(); handleEdit(order.id); }}>
                Edit
              </Button>
              <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={(event) => { event.stopPropagation(); handleGenerate(order.id); }}>
                Generate
              </Button>
            </div>
          ),
        }]
      : []),
  ];

  if (isLoading) {
    return (
      <PageState variant="loading" fullHeight={false} className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-10 w-40" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <Card key={i} className="bg-card/30 border-border/50">
              <CardContent className="p-4">
                <Skeleton className="h-4 w-32 mb-3" />
                <div className="flex gap-2 mb-3">
                  <Skeleton className="h-5 w-16" />
                  <Skeleton className="h-5 w-16" />
                </div>
                <Skeleton className="h-4 w-full mb-2" />
                <Skeleton className="h-4 w-2/3" />
              </CardContent>
            </Card>
          ))}
        </div>
      </PageState>
    );
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
      <PageHeader
        title="Standing Orders"
        description={`${totalCount} template${totalCount !== 1 ? 's' : ''}`}
        actions={(
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className={cn('h-4 w-4 mr-2', isLoading && 'animate-spin')} />
              Refresh
            </Button>
            {standingOrderManagementAvailable && (
              <Button onClick={handleCreate}>
                <Plus className="h-4 w-4 mr-2" />
                New Template
              </Button>
            )}
          </div>
        )}
      />

      <div className="p-4 sm:p-6 space-y-6">
      {!standingOrderManagementAvailable && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Standing order template management is not available in Rust V2 mode yet. Existing
          template review remains visible, but creation, editing, and generation require a
          generated /api/v2 standing-order contract.
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-3 items-start lg:items-center">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search templates..."
            value={search}
            onChange={handleSearchChange}
            className="pl-9 font-mono text-sm"
          />
        </div>

        <div className="flex items-center gap-2">
          <Switch
            id="show-inactive"
            checked={showInactive}
            onCheckedChange={handleToggleInactive}
          />
          <label htmlFor="show-inactive" className="text-sm text-muted-foreground cursor-pointer">
            Show inactive
          </label>
        </div>

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground">
            <X className="h-4 w-4 mr-1" />
            Clear
          </Button>
        )}
      </div>

      {orders.length > 0 ? (
        <div className="overflow-x-auto">
          <VirtualizedTable
            rows={orders}
            rowKey={(order) => order.id}
            rowHeight={68}
            columns={orderColumns}
            onRowClick={(order) => handleClick(order.id)}
            rowClassName="hover:bg-muted/30"
            className="min-w-[980px]"
            headerClassName="bg-muted/50 border-b border-border"
          />
        </div>
      ) : (
        <div className="bg-card/50 border rounded-2xl p-12 text-center">
          <Repeat className="h-10 w-10 text-muted-foreground/50 mx-auto mb-3" />
          <h3 className="font-display text-xl mb-2">No Standing Orders Found</h3>
          <p className="text-muted-foreground text-sm mb-4">
            {hasActiveFilters
              ? 'Try adjusting your filters'
              : 'Create a template for recurring requisitions'}
          </p>
          {!hasActiveFilters && standingOrderManagementAvailable && (
            <Button onClick={handleCreate}>
              <Plus className="h-4 w-4 mr-2" />
              New Template
            </Button>
          )}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-4 border-t">
          <p className="font-mono text-xs text-muted-foreground">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => handlePageChange(page - 1)} disabled={page <= 1}>
              <ChevronLeft className="h-4 w-4 mr-1" />
              Previous
            </Button>
            <Button variant="outline" size="sm" onClick={() => handlePageChange(page + 1)} disabled={page >= totalPages}>
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
      </div>
    </PageShell>
  );
}
