import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { InventoryPagination } from '@/features/inventory/components/InventoryPagination';
import { useInternalRequisitions, useStorageLocations } from '@/features/inventory/hooks';
import { InternalRequisitionDetailDialog } from '@/components/inventory/InternalRequisitionDetailDialog';
import { useDebounce } from '@/hooks/use-debounce';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { format, parseISO } from 'date-fns';
import Search from 'lucide-react/dist/esm/icons/search.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import Filter from 'lucide-react/dist/esm/icons/funnel.js';
import MoreHorizontal from 'lucide-react/dist/esm/icons/more-horizontal.js';
import Eye from 'lucide-react/dist/esm/icons/eye.js';
import Check from 'lucide-react/dist/esm/icons/check.js';
import Package from 'lucide-react/dist/esm/icons/package.js';
import MapPin from 'lucide-react/dist/esm/icons/map-pin.js';
import User from 'lucide-react/dist/esm/icons/user.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import Repeat from 'lucide-react/dist/esm/icons/repeat.js';

const LEGACY_STATUS_TABS = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'pending_approval', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'fulfilled', label: 'Fulfilled' },
  { value: 'partially_fulfilled', label: 'Partial' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'cancelled', label: 'Cancelled' },
];

const RUST_V2_STATUS_TABS = [
  { value: 'all', label: 'All' },
  { value: 'requested', label: 'Requested' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'fulfilled', label: 'Fulfilled' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'cancelled', label: 'Cancelled' },
];

const STATUS_CONFIG = {
  requested: {
    label: 'Requested',
    bgColor: 'bg-muted',
    textColor: 'text-muted-foreground',
    borderColor: 'border-border',
  },
  pending: {
    label: 'Pending',
    bgColor: 'bg-amber-500/10',
    textColor: 'text-amber-500',
    borderColor: 'border-amber-500/30',
  },
  draft: {
    label: 'Draft',
    bgColor: 'bg-muted',
    textColor: 'text-muted-foreground',
    borderColor: 'border-border',
  },
  pending_approval: {
    label: 'Pending Approval',
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
  in_progress: {
    label: 'In Progress',
    bgColor: 'bg-indigo-500/10',
    textColor: 'text-indigo-500',
    borderColor: 'border-indigo-500/30',
  },
  fulfilled: {
    label: 'Fulfilled',
    bgColor: 'bg-emerald-500/10',
    textColor: 'text-emerald-500',
    borderColor: 'border-emerald-500/30',
  },
  partially_fulfilled: {
    label: 'Partially Fulfilled',
    bgColor: 'bg-teal-500/10',
    textColor: 'text-teal-500',
    borderColor: 'border-teal-500/30',
  },
  rejected: {
    label: 'Rejected',
    bgColor: 'bg-rose-500/10',
    textColor: 'text-rose-500',
    borderColor: 'border-rose-500/30',
  },
  cancelled: {
    label: 'Cancelled',
    bgColor: 'bg-muted',
    textColor: 'text-muted-foreground',
    borderColor: 'border-border',
  },
};

const PRIORITY_CONFIG = {
  low: { label: 'Low', color: 'text-muted-foreground' },
  normal: { label: 'Normal', color: 'text-sky-500' },
  high: { label: 'High', color: 'text-amber-500' },
  urgent: { label: 'Urgent', color: 'text-rose-500' },
};

function getStatusConfig(status) {
  return STATUS_CONFIG[status?.toLowerCase()] || STATUS_CONFIG.draft;
}

function getPriorityConfig(priority) {
  return PRIORITY_CONFIG[priority?.toLowerCase()] || PRIORITY_CONFIG.normal;
}

/**
 * InternalRequisitionCard - Card display for internal requisitions
 */
function InternalRequisitionCard({
  requisition,
  index = 0,
  onClick,
  onApprove,
  onFulfill,
}) {
  const statusConfig = getStatusConfig(requisition.status);
  const priorityConfig = getPriorityConfig(requisition.priority);

  const canApprove = requisition.status === 'pending_approval';
  const canFulfill = ['approved', 'in_progress'].includes(requisition.status);

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
            <ClipboardList className="size-4 text-muted-foreground" />
            <span className="font-mono text-sm font-medium text-primary">
              {requisition.requisition_number || requisition.number}
            </span>
            {requisition.is_standing_order && (
              <Badge variant="outline" className="text-[10px]">
                <Repeat className="size-3 mr-1" />
                Standing
              </Badge>
            )}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button
                variant="ghost"
                size="sm"
                className="size-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onClick?.(); }}>
                <Eye className="size-4 mr-2" />
                View Details
              </DropdownMenuItem>
              {canApprove && onApprove && (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onApprove(); }}>
                  <Check className="size-4 mr-2" />
                  Approve
                </DropdownMenuItem>
              )}
              {canFulfill && onFulfill && (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onFulfill(); }}>
                  <Package className="size-4 mr-2" />
                  Fulfill
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
          {requisition.priority && requisition.priority !== 'normal' && (
            <span className={cn('text-xs font-medium', priorityConfig.color)}>
              {priorityConfig.label}
            </span>
          )}
        </div>

        <div className="space-y-2 mb-3">
          {requisition.requesting_location_name && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <MapPin className="size-3" />
              <span>{requisition.requesting_location_name}</span>
            </div>
          )}
          {requisition.requested_by_name && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <User className="size-3" />
              <span>{requisition.requested_by_name}</span>
            </div>
          )}
          {requisition.date_required && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Calendar className="size-3" />
              <span className="font-mono">
                {format(parseISO(requisition.date_required), 'MMM d, yyyy')}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-border">
          <div className="text-xs text-muted-foreground">
            {requisition.items_count || 0} item{(requisition.items_count || 0) !== 1 ? 's' : ''}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function useInternalRequisitionFilters({ statusTabs = LEGACY_STATUS_TABS } = {}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlSearch = searchParams.get('search') || '';
  const [search, setSearch] = useState(urlSearch);

  const rawStatus = searchParams.get('status') || 'all';
  const status = statusTabs.some((tab) => tab.value === rawStatus) ? rawStatus : 'all';
  const location = searchParams.get('location') || '';
  const page = parseInt(searchParams.get('page') || '1', 10);
  const debouncedSearch = useDebounce(search, 300);

  useEffect(() => {
    setSearch((current) => (current === urlSearch ? current : urlSearch));
  }, [urlSearch]);

  useEffect(() => {
    if (rawStatus === status) return;
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.delete('status');
      params.set('page', '1');
      return params;
    });
  }, [rawStatus, setSearchParams, status]);

  const handleTabChange = (value) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (value !== 'all') params.set('status', value);
      else params.delete('status');
      params.set('page', '1');
      return params;
    });
  };

  const handleLocationChange = (value) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (value && value !== 'all') params.set('location', value);
      else params.delete('location');
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

  const handleSearchChange = (value) => {
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
  };

  return {
    search,
    status,
    location,
    page,
    queryParams: {
      page,
      page_size: 20,
      ...(debouncedSearch && { search: debouncedSearch }),
      ...(status !== 'all' && { status }),
      ...(location && { requesting_location: location }),
    },
    hasActiveFilters: Boolean(debouncedSearch || status !== 'all' || location),
    handleSearchChange,
    handleTabChange,
    handleLocationChange,
    handlePageChange,
    clearFilters,
  };
}

function InternalRequisitionsHeader({ totalCount, isLoading, onRefresh }) {
  return (
    <PageHeader
      title="Internal Requisitions"
      description={`${totalCount} requisition${totalCount !== 1 ? 's' : ''}`}
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
        </div>
      )}
    />
  );
}

function InternalRequisitionsLoadingState() {
  return (
    <PageState variant="loading" fullHeight={false} className="space-y-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-9 w-56" />
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

function InternalRequisitionStatusTabs({ status, statusTabs, onTabChange }) {
  return (
    <Tabs value={status} onValueChange={onTabChange}>
      <TabsList className="w-full sm:w-auto">
        {statusTabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value} className="font-mono text-xs">
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

function InternalRequisitionFilters({
  search,
  location,
  locations,
  hasActiveFilters,
  onSearchChange,
  onLocationChange,
  onClearFilters,
}) {
  return (
    <div className="flex flex-col lg:flex-row gap-3">
      <div className="relative flex-1 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder="Search by number..."
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          className="pl-9 font-mono text-sm"
        />
      </div>

      <Select value={location || 'all'} onValueChange={onLocationChange}>
        <SelectTrigger className="w-full lg:w-[200px] font-mono text-sm">
          <Filter className="size-4 mr-2 text-muted-foreground" />
          <SelectValue placeholder="Location" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Locations</SelectItem>
          {locations.map((loc) => (
            <SelectItem key={loc.id} value={loc.id.toString()}>{loc.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {hasActiveFilters && (
        <Button variant="ghost" size="sm" onClick={onClearFilters} className="text-muted-foreground">
          <X className="size-4 mr-1" />
          Clear
        </Button>
      )}
    </div>
  );
}

function createRequisitionColumns({ onOpen, onApprove, onFulfill }) {
  return [
    {
      key: 'number',
      header: 'Requisition #',
      width: '180px',
      render: (req) => <span className="font-mono text-sm font-medium text-primary">{req.requisition_number || req.number}</span>,
    },
    {
      key: 'location',
      header: 'Requesting Location',
      width: '220px',
      render: (req) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{req.requesting_location_name || 'Unknown location'}</p>
          <p className="truncate text-xs text-muted-foreground">{req.requested_by_name || 'Unknown requester'}</p>
        </div>
      ),
    },
    {
      key: 'priority',
      header: 'Priority',
      width: '120px',
      render: (req) => {
        const priorityConfig = getPriorityConfig(req.priority);
        return <span className={cn('text-xs font-medium', priorityConfig.color)}>{priorityConfig.label}</span>;
      },
    },
    {
      key: 'status',
      header: 'Status',
      width: '140px',
      render: (req) => {
        const statusConfig = getStatusConfig(req.status);
        return <Badge variant="outline" className={cn('text-xs', statusConfig.bgColor, statusConfig.textColor, statusConfig.borderColor)}>{statusConfig.label}</Badge>;
      },
    },
    {
      key: 'date_required',
      header: 'Date Required',
      width: '160px',
      render: (req) => (
        <span className="font-mono text-sm text-muted-foreground">
          {req.date_required ? format(parseISO(req.date_required), 'MMM d, yyyy') : '—'}
        </span>
      ),
    },
    {
      key: 'items',
      header: 'Items',
      width: '100px',
      render: (req) => <span className="font-mono text-sm text-muted-foreground">{req.items_count || 0}</span>,
    },
    {
      key: 'actions',
      header: '',
      width: '180px',
      render: (req) => (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs"
            onClick={(event) => {
              event.stopPropagation();
              if (req.status === 'pending_approval') onApprove(req.id);
              else if (['approved', 'in_progress'].includes(req.status)) onFulfill(req.id);
              else onOpen(req.id);
            }}
          >
            {req.status === 'pending_approval'
              ? 'Review'
              : ['approved', 'in_progress'].includes(req.status)
              ? 'Issue'
              : 'View'}
          </Button>
        </div>
      ),
    },
  ];
}

function InternalRequisitionsTable({
  requisitions,
  columns,
  hasActiveFilters,
  onOpen,
}) {
  if (requisitions.length === 0) {
    return (
      <div className="bg-card/50 border rounded-2xl p-12 text-center">
        <ClipboardList className="size-10 text-muted-foreground/50 mx-auto mb-3" />
        <h3 className="font-display text-xl mb-2">No Requisitions Found</h3>
        <p className="text-muted-foreground text-sm mb-4">
          {hasActiveFilters ? 'Try adjusting your filters' : 'Ward stock requests will appear here after submission'}
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <VirtualizedTable
        rows={requisitions}
        rowKey={(req) => req.id}
        rowHeight={68}
        columns={columns}
        onRowClick={(req) => onOpen(req.id)}
        rowClassName="hover:bg-muted/30"
        className="min-w-[1100px]"
        headerClassName="bg-muted/50 border-b border-border"
      />
    </div>
  );
}

/**
 * InternalRequisitionsPage - Internal department requisitions page
 */
export default function InternalRequisitionsPage() {
  const [selectedRequisitionId, setSelectedRequisitionId] = useState(null);
  const rustV2Mode = isRustV2ApiMode();
  const statusTabs = rustV2Mode ? RUST_V2_STATUS_TABS : LEGACY_STATUS_TABS;
  const {
    search,
    status,
    location,
    page,
    queryParams,
    hasActiveFilters,
    handleSearchChange,
    handleTabChange,
    handleLocationChange,
    handlePageChange,
    clearFilters,
  } = useInternalRequisitionFilters({ statusTabs });

  const { data: requisitionsData, isLoading, error, refetch } = useInternalRequisitions(queryParams);
  const { data: locationsData } = useStorageLocations();

  const requisitions = requisitionsData?.results || [];
  const totalCount = requisitionsData?.count || 0;
  const locations = locationsData?.results || locationsData || [];

  const handleClick = (id) => setSelectedRequisitionId(id);
  const handleApprove = (id) => setSelectedRequisitionId(id);
  const handleFulfill = (id) => setSelectedRequisitionId(id);
  const requisitionColumns = createRequisitionColumns({
    onOpen: handleClick,
    onApprove: handleApprove,
    onFulfill: handleFulfill,
  });

  if (isLoading) {
    return <InternalRequisitionsLoadingState />;
  }

  if (error) {
    return (
      <PageState
        variant="error"
        title="Error Loading Requisitions"
        description={error.message}
        action={() => refetch()}
      />
    );
  }

  return (
    <PageShell>
      <InternalRequisitionsHeader
        totalCount={totalCount}
        isLoading={isLoading}
        onRefresh={refetch}
      />

      <div className="p-4 sm:p-6 space-y-6">
        <>
          <InternalRequisitionStatusTabs
            status={status}
            statusTabs={statusTabs}
            onTabChange={handleTabChange}
          />

          <InternalRequisitionFilters
            search={search}
            location={location}
            locations={locations}
            hasActiveFilters={hasActiveFilters}
            onSearchChange={handleSearchChange}
            onLocationChange={handleLocationChange}
            onClearFilters={clearFilters}
          />
        </>

        <InternalRequisitionsTable
          requisitions={requisitions}
          columns={requisitionColumns}
          hasActiveFilters={hasActiveFilters}
          onOpen={handleClick}
        />

        <InventoryPagination
          data={requisitionsData}
          itemLabel="requisitions"
          page={page}
          pageSize={20}
          onPageChange={handlePageChange}
        />
      </div>

      <InternalRequisitionDetailDialog
        requisitionId={selectedRequisitionId}
        open={!!selectedRequisitionId}
        onOpenChange={(open) => {
          if (!open) setSelectedRequisitionId(null);
        }}
        mode="inventory"
      />
    </PageShell>
  );
}
