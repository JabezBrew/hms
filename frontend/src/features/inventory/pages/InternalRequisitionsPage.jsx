import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useInternalRequisitions, useStorageLocations } from '@/features/inventory/hooks';
import { InternalRequisitionDetailDialog } from '@/components/inventory/InternalRequisitionDetailDialog';
import { useDebounce } from '@/hooks/use-debounce';
import { format, parseISO } from 'date-fns';
import Search from 'lucide-react/dist/esm/icons/search.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
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

const STATUS_TABS = [
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

const STATUS_CONFIG = {
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

/**
 * InternalRequisitionsPage - Internal department requisitions page
 */
export default function InternalRequisitionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [selectedRequisitionId, setSelectedRequisitionId] = useState(null);
  const status = searchParams.get('status') || 'all';
  const location = searchParams.get('location') || '';
  const page = parseInt(searchParams.get('page') || '1', 10);

  const debouncedSearch = useDebounce(search, 300);

  const queryParams = {
    page,
    page_size: 20,
    ...(debouncedSearch && { search: debouncedSearch }),
    ...(status !== 'all' && { status }),
    ...(location && { requesting_location: location }),
  };

  const { data: requisitionsData, isLoading, error, refetch } = useInternalRequisitions(queryParams);
  const { data: locationsData } = useStorageLocations();

  const requisitions = requisitionsData?.results || [];
  const totalCount = requisitionsData?.count || 0;
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

  const hasActiveFilters = debouncedSearch || status !== 'all' || location;

  const handleClick = (id) => setSelectedRequisitionId(id);
  const handleApprove = (id) => setSelectedRequisitionId(id);
  const handleFulfill = (id) => setSelectedRequisitionId(id);

  const requisitionColumns = [
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
              if (req.status === 'pending_approval') handleApprove(req.id);
              else if (['approved', 'in_progress'].includes(req.status)) handleFulfill(req.id);
              else handleClick(req.id);
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

  if (isLoading) {
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
      <PageHeader
        title="Internal Requisitions"
        description={`${totalCount} requisition${totalCount !== 1 ? 's' : ''}`}
        actions={(
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className={cn('size-4 mr-2', isLoading && 'animate-spin')} />
              Refresh
            </Button>
          </div>
        )}
      />

      <div className="p-4 sm:p-6 space-y-6">

      <Tabs value={status} onValueChange={handleTabChange}>
        <TabsList className="w-full sm:w-auto">
          {STATUS_TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="font-mono text-xs">
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex flex-col lg:flex-row gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search by number..."
            value={search}
            onChange={handleSearchChange}
            className="pl-9 font-mono text-sm"
          />
        </div>

        <Select value={location || 'all'} onValueChange={handleLocationChange}>
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
          <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground">
            <X className="size-4 mr-1" />
            Clear
          </Button>
        )}
      </div>

      {requisitions.length > 0 ? (
        <div className="overflow-x-auto">
          <VirtualizedTable
            rows={requisitions}
            rowKey={(req) => req.id}
            rowHeight={68}
            columns={requisitionColumns}
            onRowClick={(req) => handleClick(req.id)}
            rowClassName="hover:bg-muted/30"
            className="min-w-[1100px]"
            headerClassName="bg-muted/50 border-b border-border"
          />
        </div>
      ) : (
        <div className="bg-card/50 border rounded-2xl p-12 text-center">
          <ClipboardList className="size-10 text-muted-foreground/50 mx-auto mb-3" />
          <h3 className="font-display text-xl mb-2">No Requisitions Found</h3>
          <p className="text-muted-foreground text-sm mb-4">
            {hasActiveFilters ? 'Try adjusting your filters' : 'Ward stock requests will appear here after submission'}
          </p>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-4 border-t">
          <p className="font-mono text-xs text-muted-foreground">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => handlePageChange(page - 1)} disabled={page <= 1}>
              <ChevronLeft className="size-4 mr-1" />
              Previous
            </Button>
            <Button variant="outline" size="sm" onClick={() => handlePageChange(page + 1)} disabled={page >= totalPages}>
              Next
              <ChevronRight className="size-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
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
