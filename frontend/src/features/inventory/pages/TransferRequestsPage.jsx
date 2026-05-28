import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
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
import X from 'lucide-react/dist/esm/icons/x.js';
import Filter from 'lucide-react/dist/esm/icons/funnel.js';

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

function useTransferRequestFilters() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const status = searchParams.get('status') || 'all';
  const fromLocation = searchParams.get('from') || '';
  const toLocation = searchParams.get('to') || '';
  const action = searchParams.get('action');
  const page = parseInt(searchParams.get('page') || '1', 10);
  const debouncedSearch = useDebounce(search, 300);

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

  const handleTabChange = useCallback((value) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (value !== 'all') {
        params.set('status', value);
      } else {
        params.delete('status');
      }
      params.set('page', '1');
      return params;
    });
  }, [setSearchParams]);

  const handleFromLocationChange = useCallback((value) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (value && value !== 'all') {
        params.set('from', value);
      } else {
        params.delete('from');
      }
      params.set('page', '1');
      return params;
    });
  }, [setSearchParams]);

  const handleToLocationChange = useCallback((value) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (value && value !== 'all') {
        params.set('to', value);
      } else {
        params.delete('to');
      }
      params.set('page', '1');
      return params;
    });
  }, [setSearchParams]);

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

  const queryParams = useMemo(() => ({
    page,
    page_size: 20,
    ...(debouncedSearch && { search: debouncedSearch }),
    ...(status !== 'all' && { status }),
    ...(fromLocation && { from_location: fromLocation }),
    ...(toLocation && { to_location: toLocation }),
  }), [debouncedSearch, fromLocation, page, status, toLocation]);

  return {
    search,
    status,
    fromLocation,
    toLocation,
    action,
    page,
    queryParams,
    hasActiveFilters: Boolean(debouncedSearch || status !== 'all' || fromLocation || toLocation),
    handleSearchChange: (event) => setSearch(event.target.value),
    handleTabChange,
    handleFromLocationChange,
    handleToLocationChange,
    handlePageChange,
    clearFilters,
    setSearchParams,
  };
}

function createTransferColumns({
  transferActionsAvailable,
  onApprove,
  onDispatch,
  onReceive,
}) {
  const columns = [
    {
      key: 'number',
      header: 'Transfer #',
      width: '180px',
      render: (transfer) => (
        <span className="font-mono text-sm font-medium text-primary">
          {transfer.transfer_number || transfer.number}
        </span>
      ),
    },
    {
      key: 'route',
      header: 'Route',
      width: '260px',
      render: (transfer) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">
            {transfer.from_location_name || 'Source'} → {transfer.to_location_name || 'Destination'}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {transfer.requested_by_name || 'Unknown requester'}
          </p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '140px',
      render: (transfer) => {
        const statusConfig = getStatusConfig(transfer.status);
        return (
          <Badge
            variant="outline"
            className={cn('text-xs', statusConfig.bgColor, statusConfig.textColor, statusConfig.borderColor)}
          >
            {statusConfig.label}
          </Badge>
        );
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
  ];

  if (!transferActionsAvailable) {
    return columns;
  }

  return [
    ...columns,
    {
      key: 'actions',
      header: '',
      width: '200px',
      render: (transfer) => (
        <div className="flex items-center justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs"
            onClick={(event) => { event.stopPropagation(); onApprove(transfer.id); }}
          >
            Approve
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs"
            onClick={(event) => { event.stopPropagation(); onDispatch(transfer.id); }}
          >
            Dispatch
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs"
            onClick={(event) => { event.stopPropagation(); onReceive(transfer.id); }}
          >
            Receive
          </Button>
        </div>
      ),
    },
  ];
}

function TransferRequestsLoadingState() {
  return (
    <PageState variant="loading" fullHeight={false} className="space-y-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-10 w-40" />
      </div>
      <Skeleton className="h-10 w-full max-w-xl" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="bg-card/30 border border-border/50 rounded-lg p-4">
            <Skeleton className="h-4 w-24 mb-3" />
            <Skeleton className="h-5 w-20 mb-3" />
            <Skeleton className="h-4 w-full mb-2" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ))}
      </div>
    </PageState>
  );
}

function TransferRequestsHeader({ totalCount, isLoading, onRefresh, onCreate }) {
  return (
    <PageHeader
      title="Transfer Requests"
      description={`${totalCount} transfer${totalCount !== 1 ? 's' : ''}`}
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
          <Button onClick={onCreate}>
            <Plus className="size-4 mr-2" />
            New Transfer
          </Button>
        </div>
      )}
    />
  );
}

function TransferActionsNotice({ transferActionsAvailable }) {
  if (transferActionsAvailable) {
    return null;
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      Transfer approval, dispatch, and receiving are not available in Rust V2 mode yet.
      New transfer request creation and transfer review remain available.
    </div>
  );
}

function TransferStatusTabs({ status, onStatusChange }) {
  return (
    <Tabs value={status} onValueChange={onStatusChange}>
      <TabsList className="w-full sm:w-auto overflow-x-auto">
        {STATUS_TABS.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value} className="font-mono text-xs">
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

function TransferFilters({
  search,
  fromLocation,
  toLocation,
  locations,
  hasActiveFilters,
  onSearchChange,
  onFromLocationChange,
  onToLocationChange,
  onClearFilters,
}) {
  return (
    <div className="flex flex-col lg:flex-row gap-3">
      <div className="relative flex-1 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder="Search by transfer number..."
          value={search}
          onChange={onSearchChange}
          className="pl-9 font-mono text-sm"
        />
      </div>

      <Select value={fromLocation || 'all'} onValueChange={onFromLocationChange}>
        <SelectTrigger className="w-full lg:w-[180px] font-mono text-sm">
          <Filter className="size-4 mr-2 text-muted-foreground" />
          <SelectValue placeholder="From" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Sources</SelectItem>
          {locations.map((loc) => (
            <SelectItem key={loc.id} value={loc.id.toString()}>{loc.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={toLocation || 'all'} onValueChange={onToLocationChange}>
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
        <Button variant="ghost" size="sm" onClick={onClearFilters} className="text-muted-foreground">
          <X className="size-4 mr-1" />
          Clear
        </Button>
      )}
    </div>
  );
}

function TransfersTable({ transfers, columns, onOpenTransfer }) {
  return (
    <div className="overflow-x-auto">
      <VirtualizedTable
        rows={transfers}
        rowKey={(transfer) => transfer.id}
        rowHeight={68}
        columns={columns}
        onRowClick={(transfer) => onOpenTransfer(transfer.id)}
        rowClassName="hover:bg-muted/30"
        className="min-w-[1060px]"
        headerClassName="bg-muted/50 border-b border-border"
      />
    </div>
  );
}

function TransfersEmptyState({ hasActiveFilters, onCreate }) {
  return (
    <div className="bg-card/50 border rounded-2xl p-12 text-center">
      <ArrowRightLeft className="size-10 text-muted-foreground/50 mx-auto mb-3" />
      <h3 className="font-display text-xl mb-2">No Transfers Found</h3>
      <p className="text-muted-foreground text-sm mb-4">
        {hasActiveFilters ? 'Try adjusting your filters' : 'Create a new transfer request'}
      </p>
      {!hasActiveFilters && (
        <Button onClick={onCreate}>
          <Plus className="size-4 mr-2" />
          New Transfer
        </Button>
      )}
    </div>
  );
}

function TransfersDisplay({ transfers, columns, hasActiveFilters, onOpenTransfer, onCreate }) {
  if (transfers.length === 0) {
    return <TransfersEmptyState hasActiveFilters={hasActiveFilters} onCreate={onCreate} />;
  }

  return (
    <TransfersTable
      transfers={transfers}
      columns={columns}
      onOpenTransfer={onOpenTransfer}
    />
  );
}

function TransfersPagination({ page, totalPages, onPageChange }) {
  if (totalPages <= 1) {
    return null;
  }

  return (
    <div className="flex items-center justify-between pt-4 border-t">
      <p className="font-mono text-xs text-muted-foreground">
        Page {page} of {totalPages}
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>
          <ChevronLeft className="size-4 mr-1" />
          Previous
        </Button>
        <Button variant="outline" size="sm" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}>
          Next
          <ChevronRight className="size-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}

function CreateTransferSheet({ isOpen, initialToLocation, onClose, onCreateSuccess }) {
  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
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
            onSuccess={onCreateSuccess}
            onCancel={onClose}
          />
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

/**
 * TransferRequestsPage - Stock transfer requests page
 */
export default function TransferRequestsPage() {
  const navigate = useNavigate();
  const transferActionsAvailable = !isRustV2ApiMode();
  const {
    search,
    status,
    fromLocation,
    toLocation,
    action,
    page,
    queryParams,
    hasActiveFilters,
    handleSearchChange,
    handleTabChange,
    handleFromLocationChange,
    handleToLocationChange,
    handlePageChange,
    clearFilters,
    setSearchParams,
  } = useTransferRequestFilters();
  const { data: transfersData, isLoading, error, refetch } = useTransferRequests(queryParams);
  const { data: locationsData } = useStorageLocations();
  const transfers = transfersData?.results || [];
  const totalCount = transfersData?.count || 0;
  const totalPages = Math.ceil(totalCount / 20);
  const locations = locationsData?.results || locationsData || [];
  const isCreateOpen = action === 'create';
  const initialToLocation = toLocation;

  const handleClick = useCallback((id) => {
    navigate(`/inventory/transfers/${id}`);
  }, [navigate]);
  const handleApprove = useCallback((id) => {
    if (transferActionsAvailable) {
      navigate(`/inventory/transfers/${id}?action=approve`);
    }
  }, [navigate, transferActionsAvailable]);
  const handleDispatch = useCallback((id) => {
    if (transferActionsAvailable) {
      navigate(`/inventory/transfers/${id}?action=dispatch`);
    }
  }, [navigate, transferActionsAvailable]);
  const handleReceive = useCallback((id) => {
    if (transferActionsAvailable) {
      navigate(`/inventory/transfers/${id}?action=receive`);
    }
  }, [navigate, transferActionsAvailable]);
  const handleCreate = useCallback(() => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set('action', 'create');
      return params;
    });
  }, [setSearchParams]);
  const handleCloseSheet = useCallback(() => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.delete('action');
      return params;
    });
  }, [setSearchParams]);
  const handleCreateSuccess = useCallback(() => {
    handleCloseSheet();
    refetch();
  }, [handleCloseSheet, refetch]);
  const transferColumns = useMemo(() => createTransferColumns({
    transferActionsAvailable,
    onApprove: handleApprove,
    onDispatch: handleDispatch,
    onReceive: handleReceive,
  }), [handleApprove, handleDispatch, handleReceive, transferActionsAvailable]);

  if (isLoading && !transfersData) {
    return <TransferRequestsLoadingState />;
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
      <TransferRequestsHeader
        totalCount={totalCount}
        isLoading={isLoading}
        onRefresh={refetch}
        onCreate={handleCreate}
      />

      <div className="p-4 sm:p-6 space-y-6">
        <TransferActionsNotice transferActionsAvailable={transferActionsAvailable} />

        <TransferStatusTabs status={status} onStatusChange={handleTabChange} />

        <TransferFilters
          search={search}
          fromLocation={fromLocation}
          toLocation={toLocation}
          locations={locations}
          hasActiveFilters={hasActiveFilters}
          onSearchChange={handleSearchChange}
          onFromLocationChange={handleFromLocationChange}
          onToLocationChange={handleToLocationChange}
          onClearFilters={clearFilters}
        />

        <TransfersDisplay
          transfers={transfers}
          columns={transferColumns}
          hasActiveFilters={hasActiveFilters}
          onOpenTransfer={handleClick}
          onCreate={handleCreate}
        />

        <TransfersPagination
          page={page}
          totalPages={totalPages}
          onPageChange={handlePageChange}
        />

        <CreateTransferSheet
          isOpen={isCreateOpen}
          initialToLocation={initialToLocation}
          onClose={handleCloseSheet}
          onCreateSuccess={handleCreateSuccess}
        />
      </div>
    </PageShell>
  );
}
