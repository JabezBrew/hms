import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import VirtualizedTable from '@/components/ui/VirtualizedTable';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageState } from '@/shared/components/page/PageState';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetBody,
  SheetTitle,
} from '@/components/ui/sheet';
import { TransferRequestForm } from '@/components/inventory';
import { useTransferRequests, useStorageLocations } from '@/features/inventory/hooks';
import { useDebounce } from '@/hooks/use-debounce';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { format, parseISO } from 'date-fns';
import Search from 'lucide-react/dist/esm/icons/search.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import ArrowRightLeft from 'lucide-react/dist/esm/icons/arrow-right-left.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import Filter from 'lucide-react/dist/esm/icons/funnel.js';
import MoreHorizontal from 'lucide-react/dist/esm/icons/more-horizontal.js';
import Eye from 'lucide-react/dist/esm/icons/eye.js';
import Check from 'lucide-react/dist/esm/icons/check.js';
import Truck from 'lucide-react/dist/esm/icons/truck.js';
import Package from 'lucide-react/dist/esm/icons/package.js';
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right.js';
import MapPin from 'lucide-react/dist/esm/icons/map-pin.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import User from 'lucide-react/dist/esm/icons/user.js';

const STATUS_TABS = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'in_transit', label: 'In Transit' },
  { value: 'received', label: 'Received' },
];

const STATUS_CONFIG = {
  pending: {
    label: 'Pending',
    bgColor: 'bg-amber-500/10',
    textColor: 'text-amber-500',
    borderColor: 'border-amber-500/30',
  },
  approved: {
    label: 'Approved',
    bgColor: 'bg-sky-500/10',
    textColor: 'text-sky-500',
    borderColor: 'border-sky-500/30',
  },
  in_transit: {
    label: 'In Transit',
    bgColor: 'bg-violet-500/10',
    textColor: 'text-violet-500',
    borderColor: 'border-violet-500/30',
  },
  received: {
    label: 'Received',
    bgColor: 'bg-emerald-500/10',
    textColor: 'text-emerald-500',
    borderColor: 'border-emerald-500/30',
  },
  cancelled: {
    label: 'Cancelled',
    bgColor: 'bg-muted',
    textColor: 'text-muted-foreground',
    borderColor: 'border-border',
  },
};

function getStatusConfig(status) {
  return STATUS_CONFIG[status?.toLowerCase()] || STATUS_CONFIG.pending;
}

/**
 * TransferCard - Card display for transfer requests
 */
function TransferCard({
  transfer,
  index = 0,
  onClick,
  onApprove,
  onDispatch,
  onReceive,
}) {
  const statusConfig = getStatusConfig(transfer.status);

  const canApprove = transfer.status === 'pending';
  const canDispatch = transfer.status === 'approved';
  const canReceive = transfer.status === 'in_transit';

  return (
    <Card
      className={cn(
        'group relative bg-card/30 border-border/50',
        'hover:border-primary/30 hover:shadow-[0_0_20px_-8px_var(--chronicle-amber)]',
        'transition-all duration-300 cursor-pointer',
        'animate-chronicle-enter'
      )}
      style={{ animationDelay: `${index * 50}ms` }}
      onClick={onClick}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
            <span className="font-mono text-sm font-medium text-primary">
              {transfer.transfer_number || transfer.number}
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
              {canApprove && onApprove && (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onApprove(); }}>
                  <Check className="h-4 w-4 mr-2" />
                  Approve
                </DropdownMenuItem>
              )}
              {canDispatch && onDispatch && (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onDispatch(); }}>
                  <Truck className="h-4 w-4 mr-2" />
                  Dispatch
                </DropdownMenuItem>
              )}
              {canReceive && onReceive && (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onReceive(); }}>
                  <Package className="h-4 w-4 mr-2" />
                  Receive
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center gap-2 mb-3">
          <Badge
            variant="outline"
            className={cn(
              'text-xs',
              statusConfig.bgColor,
              statusConfig.textColor,
              statusConfig.borderColor
            )}
          >
            {statusConfig.label}
          </Badge>
        </div>

        {/* From/To locations */}
        <div className="flex items-center gap-2 mb-3 text-sm">
          <div className="flex items-center gap-1 text-muted-foreground">
            <MapPin className="h-3 w-3" />
            <span className="truncate max-w-[100px]">{transfer.from_location_name || 'Source'}</span>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <div className="flex items-center gap-1">
            <MapPin className="h-3 w-3 text-primary" />
            <span className="truncate max-w-[100px]">{transfer.to_location_name || 'Destination'}</span>
          </div>
        </div>

        <div className="space-y-1 mb-3">
          {transfer.requested_by_name && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <User className="h-3 w-3" />
              <span>{transfer.requested_by_name}</span>
            </div>
          )}
          {transfer.created_at && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Calendar className="h-3 w-3" />
              <span className="font-mono">
                {format(parseISO(transfer.created_at), 'MMM d, yyyy')}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-border">
          <div className="text-xs text-muted-foreground">
            {transfer.items_count || 0} item{(transfer.items_count || 0) !== 1 ? 's' : ''}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * TransferRequestsPage - Stock transfer requests page
 */
export default function TransferRequestsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const transferActionsAvailable = !isRustV2ApiMode();

  const [search, setSearch] = useState(searchParams.get('search') || '');
  const status = searchParams.get('status') || 'all';
  const fromLocation = searchParams.get('from') || '';
  const toLocation = searchParams.get('to') || '';
  const page = parseInt(searchParams.get('page') || '1', 10);

  const debouncedSearch = useDebounce(search, 300);

  const queryParams = {
    page,
    page_size: 20,
    ...(debouncedSearch && { search: debouncedSearch }),
    ...(status !== 'all' && { status }),
    ...(fromLocation && { from_location: fromLocation }),
    ...(toLocation && { to_location: toLocation }),
  };

  const { data: transfersData, isLoading, error, refetch } = useTransferRequests(queryParams);
  const { data: locationsData } = useStorageLocations();

  const transfers = transfersData?.results || [];
  const totalCount = transfersData?.count || 0;
  const totalPages = Math.ceil(totalCount / 20);
  const locations = locationsData?.results || locationsData || [];

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

  const handleTabChange = (value) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (value !== 'all') params.set('status', value);
      else params.delete('status');
      params.set('page', '1');
      return params;
    });
  };

  const handleFromLocationChange = (value) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (value && value !== 'all') params.set('from', value);
      else params.delete('from');
      params.set('page', '1');
      return params;
    });
  };

  const handleToLocationChange = (value) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (value && value !== 'all') params.set('to', value);
      else params.delete('to');
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

  const hasActiveFilters = debouncedSearch || status !== 'all' || fromLocation || toLocation;

  // Sheet state from URL
  const action = searchParams.get('action');
  const isCreateOpen = action === 'create';
  const initialToLocation = searchParams.get('to') || '';

  const handleClick = (id) => navigate(`/inventory/transfers/${id}`);
  const handleApprove = (id) => {
    if (!transferActionsAvailable) {
      return;
    }
    navigate(`/inventory/transfers/${id}?action=approve`);
  };
  const handleDispatch = (id) => {
    if (!transferActionsAvailable) {
      return;
    }
    navigate(`/inventory/transfers/${id}?action=dispatch`);
  };
  const handleReceive = (id) => {
    if (!transferActionsAvailable) {
      return;
    }
    navigate(`/inventory/transfers/${id}?action=receive`);
  };

  const handleCreate = () => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set('action', 'create');
      return params;
    });
  };

  const transferColumns = [
    {
      key: 'number',
      header: 'Transfer #',
      width: '180px',
      render: (transfer) => <span className="font-mono text-sm font-medium text-primary">{transfer.transfer_number || transfer.number}</span>,
    },
    {
      key: 'route',
      header: 'Route',
      width: '260px',
      render: (transfer) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{transfer.from_location_name || 'Source'} → {transfer.to_location_name || 'Destination'}</p>
          <p className="truncate text-xs text-muted-foreground">{transfer.requested_by_name || 'Unknown requester'}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '140px',
      render: (transfer) => {
        const statusConfig = getStatusConfig(transfer.status);
        return <Badge variant="outline" className={cn('text-xs', statusConfig.bgColor, statusConfig.textColor, statusConfig.borderColor)}>{statusConfig.label}</Badge>;
      },
    },
    {
      key: 'created',
      header: 'Created',
      width: '160px',
      render: (transfer) => (
        <span className="font-mono text-sm text-muted-foreground">
          {transfer.created_at ? format(parseISO(transfer.created_at), 'MMM d, yyyy') : '—'}
        </span>
      ),
    },
    ...(transferActionsAvailable
      ? [{
          key: 'actions',
          header: '',
          width: '200px',
          render: (transfer) => (
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={(event) => { event.stopPropagation(); handleApprove(transfer.id); }}>
                Approve
              </Button>
              <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={(event) => { event.stopPropagation(); handleDispatch(transfer.id); }}>
                Dispatch
              </Button>
              <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={(event) => { event.stopPropagation(); handleReceive(transfer.id); }}>
                Receive
              </Button>
            </div>
          ),
        }]
      : []),
  ];

  const handleCloseSheet = () => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.delete('action');
      return params;
    });
  };

  const handleCreateSuccess = () => {
    handleCloseSheet();
    refetch();
  };

  // Loading state (only show skeleton on initial load, not on refetches)
  if (isLoading && !transfersData) {
    return (
      <PageState variant="loading" fullHeight={false} className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-10 w-40" />
        </div>
        <Skeleton className="h-10 w-full max-w-xl" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <Card key={i} className="bg-card/30 border-border/50">
              <CardContent className="p-4">
                <Skeleton className="h-4 w-24 mb-3" />
                <Skeleton className="h-5 w-20 mb-3" />
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
        title="Error Loading Transfers"
        description={error.message}
        action={() => refetch()}
      />
    );
  }

  return (
    <PageShell>
      <PageHeader
        title="Transfer Requests"
        description={`${totalCount} transfer${totalCount !== 1 ? 's' : ''}`}
        actions={(
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className={cn('h-4 w-4 mr-2', isLoading && 'animate-spin')} />
              Refresh
            </Button>
            <Button onClick={handleCreate}>
              <Plus className="h-4 w-4 mr-2" />
              New Transfer
            </Button>
          </div>
        )}
      />

      <div className="p-4 sm:p-6 space-y-6">
      {!transferActionsAvailable && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Transfer approval, dispatch, and receiving are not available in Rust V2 mode yet.
          New transfer request creation and transfer review remain available.
        </div>
      )}

      <Tabs value={status} onValueChange={handleTabChange}>
        <TabsList className="w-full sm:w-auto overflow-x-auto">
          {STATUS_TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="font-mono text-xs">
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex flex-col lg:flex-row gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by transfer number..."
            value={search}
            onChange={handleSearchChange}
            className="pl-9 font-mono text-sm"
          />
        </div>

        <Select value={fromLocation || 'all'} onValueChange={handleFromLocationChange}>
          <SelectTrigger className="w-full lg:w-[180px] font-mono text-sm">
            <Filter className="h-4 w-4 mr-2 text-muted-foreground" />
            <SelectValue placeholder="From" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sources</SelectItem>
            {locations.map((loc) => (
              <SelectItem key={loc.id} value={loc.id.toString()}>{loc.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={toLocation || 'all'} onValueChange={handleToLocationChange}>
          <SelectTrigger className="w-full lg:w-[180px] font-mono text-sm">
            <SelectValue placeholder="To" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Destinations</SelectItem>
            {locations.map((loc) => (
              <SelectItem key={loc.id} value={loc.id.toString()}>{loc.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground">
            <X className="h-4 w-4 mr-1" />
            Clear
          </Button>
        )}
      </div>

      {transfers.length > 0 ? (
        <div className="overflow-x-auto">
          <VirtualizedTable
            rows={transfers}
            rowKey={(transfer) => transfer.id}
            rowHeight={68}
            columns={transferColumns}
            onRowClick={(transfer) => handleClick(transfer.id)}
            rowClassName="hover:bg-muted/30"
            className="min-w-[1060px]"
            headerClassName="bg-muted/50 border-b border-border"
          />
        </div>
      ) : (
        <div className="bg-card/50 border rounded-2xl p-12 text-center">
          <ArrowRightLeft className="h-10 w-10 text-muted-foreground/50 mx-auto mb-3" />
          <h3 className="font-display text-xl mb-2">No Transfers Found</h3>
          <p className="text-muted-foreground text-sm mb-4">
            {hasActiveFilters ? 'Try adjusting your filters' : 'Create a new transfer request'}
          </p>
          {!hasActiveFilters && (
            <Button onClick={handleCreate}>
              <Plus className="h-4 w-4 mr-2" />
              New Transfer
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

      {/* Create Transfer Sheet */}
      <Sheet open={isCreateOpen} onOpenChange={(open) => !open && handleCloseSheet()}>
        <SheetContent className="sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="font-display text-2xl">New Transfer Request</SheetTitle>
            <SheetDescription>
              Create a stock transfer request between locations.
            </SheetDescription>
          </SheetHeader>
          <SheetBody>
            <TransferRequestForm
              initialToLocation={initialToLocation}
              onSuccess={handleCreateSuccess}
              onCancel={handleCloseSheet}
            />
          </SheetBody>
        </SheetContent>
      </Sheet>
      </div>
    </PageShell>
  );
}
