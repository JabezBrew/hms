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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { RequisitionCardSkeleton } from '@/components/inventory/RequisitionCard';
import {
  formatRequisitionCurrency,
  getRequisitionPriorityConfig,
  getRequisitionStatusConfig,
} from '@/components/inventory/requisition-card-utils';
import { RequisitionForm } from '@/components/inventory';
import { useRequisitions } from '@/features/inventory/hooks';
import { useDebounce } from '@/hooks/use-debounce';
import Search from 'lucide-react/dist/esm/icons/search.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import MoreHorizontal from 'lucide-react/dist/esm/icons/more-horizontal.js';
import Eye from 'lucide-react/dist/esm/icons/eye.js';
import Check from 'lucide-react/dist/esm/icons/check.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import { format, parseISO } from 'date-fns';

const STATUS_TABS = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

const PRIORITY_OPTIONS = [
  { value: 'all', label: 'All Priorities' },
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

function useRequisitionListFilters() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const status = searchParams.get('status') || 'all';
  const priority = searchParams.get('priority') || '';
  const action = searchParams.get('action');
  const initialItems = searchParams.get('items')?.split(',').filter(Boolean) || [];
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

  const handlePriorityChange = useCallback((value) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (value && value !== 'all') {
        params.set('priority', value);
      } else {
        params.delete('priority');
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
    ...(priority && priority !== 'all' && { priority }),
  }), [debouncedSearch, page, priority, status]);

  return {
    search,
    status,
    priority,
    action,
    initialItems,
    page,
    queryParams,
    hasActiveFilters: Boolean(debouncedSearch || status !== 'all' || priority),
    handleSearchChange: (event) => setSearch(event.target.value),
    handleTabChange,
    handlePriorityChange,
    handlePageChange,
    clearFilters,
    setSearchParams,
  };
}

function createRequisitionColumns({
  onOpenRequisition,
  onApprove,
  onReject,
  onConvertToPO,
}) {
  return [
    {
      key: 'number',
      header: 'Requisition #',
      width: '200px',
      render: (requisition) => (
        <div className="flex items-center gap-2">
          <ClipboardList className="size-4 text-muted-foreground" />
          <span className="font-mono text-sm font-medium text-primary">
            {requisition.requisition_number || requisition.number}
          </span>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '140px',
      render: (requisition) => {
        const statusConfig = getRequisitionStatusConfig(requisition.status);
        return (
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
        );
      },
    },
    {
      key: 'requested_by',
      header: 'Requested By',
      width: '180px',
      render: (requisition) => (
        <span className="text-sm text-muted-foreground">
          {requisition.requested_by_name || '-'}
        </span>
      ),
    },
    {
      key: 'required_by',
      header: 'Required By',
      width: '160px',
      render: (requisition) => (
        requisition.date_required ? (
          <span className="text-sm font-mono">
            {format(parseISO(requisition.date_required), 'MMM d, yyyy')}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">-</span>
        )
      ),
    },
    {
      key: 'items',
      header: 'Items',
      width: '100px',
      headerClassName: 'text-center',
      cellClassName: 'text-center',
      render: (requisition) => (
        <span className="text-sm font-mono">
          {requisition.items_count || requisition.item_count || 0}
        </span>
      ),
    },
    {
      key: 'total',
      header: 'Total',
      width: '140px',
      headerClassName: 'text-right',
      cellClassName: 'text-right',
      render: (requisition) => (
        <span className="font-mono text-sm font-semibold">
          {formatRequisitionCurrency(requisition.total_amount || requisition.total)}
        </span>
      ),
    },
    {
      key: 'priority',
      header: 'Priority',
      width: '120px',
      render: (requisition) => {
        const priorityConfig = getRequisitionPriorityConfig(requisition.priority);
        return requisition.priority && requisition.priority !== 'normal' ? (
          <span className={cn('text-xs font-medium', priorityConfig.color)}>
            {priorityConfig.label}
          </span>
        ) : (
          <span className="text-muted-foreground text-xs">-</span>
        );
      },
    },
    {
      key: 'actions',
      header: '',
      width: '64px',
      render: (requisition) => {
        const canApprove = requisition.status === 'pending';
        const canReject = requisition.status === 'pending';
        const canConvert = requisition.status === 'approved';

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(event) => event.stopPropagation()}>
              <Button variant="ghost" size="sm" className="size-8 p-0">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={(event) => { event.stopPropagation(); onOpenRequisition(requisition.id); }}>
                <Eye className="size-4 mr-2" />
                View Details
              </DropdownMenuItem>
              {canApprove && (
                <DropdownMenuItem onClick={(event) => { event.stopPropagation(); onApprove(requisition.id); }}>
                  <Check className="size-4 mr-2" />
                  Approve
                </DropdownMenuItem>
              )}
              {canReject && (
                <DropdownMenuItem onClick={(event) => { event.stopPropagation(); onReject(requisition.id); }}>
                  <X className="size-4 mr-2" />
                  Reject
                </DropdownMenuItem>
              )}
              {canConvert && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={(event) => { event.stopPropagation(); onConvertToPO(requisition.id); }}>
                    <FileText className="size-4 mr-2" />
                    Convert to PO
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];
}

function RequisitionsLoadingState() {
  return (
    <PageState variant="loading" fullHeight={false} className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-5 w-32 mt-2" />
        </div>
        <Skeleton className="h-10 w-40" />
      </div>
      <Skeleton className="h-10 w-full max-w-md" />
      <div className="flex gap-3">
        <Skeleton className="h-10 flex-1 max-w-md" />
        <Skeleton className="h-10 w-40" />
      </div>
      <div className="space-y-3">
        {[...Array(6)].map((_, i) => (
          <RequisitionCardSkeleton key={i} />
        ))}
      </div>
    </PageState>
  );
}

function RequisitionsHeader({ totalCount, isLoading, onRefresh, onCreateRequisition }) {
  return (
    <PageHeader
      title="Purchase Requisitions"
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
          <Button onClick={onCreateRequisition}>
            <Plus className="size-4 mr-2" />
            New Requisition
          </Button>
        </div>
      )}
    />
  );
}

function RequisitionStatusTabs({ status, onStatusChange }) {
  return (
    <Tabs value={status} onValueChange={onStatusChange}>
      <TabsList className="w-full sm:w-auto">
        {STATUS_TABS.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value} className="font-mono text-xs">
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

function RequisitionsFilters({
  search,
  priority,
  hasActiveFilters,
  onSearchChange,
  onPriorityChange,
  onClearFilters,
}) {
  return (
    <div className="flex flex-col lg:flex-row gap-3">
      <div className="relative flex-1 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder="Search by number or requester..."
          value={search}
          onChange={onSearchChange}
          className="pl-9 font-mono text-sm"
        />
      </div>

      <Select value={priority || 'all'} onValueChange={onPriorityChange}>
        <SelectTrigger className="w-full lg:w-[180px] font-mono text-sm">
          <SelectValue placeholder="Priority" />
        </SelectTrigger>
        <SelectContent>
          {PRIORITY_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value} className="font-mono text-sm">
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {hasActiveFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onClearFilters}
          className="font-mono text-xs text-muted-foreground hover:text-foreground"
        >
          <X className="size-4 mr-1" />
          Clear
        </Button>
      )}
    </div>
  );
}

function RequisitionsTable({ requisitions, columns, onOpenRequisition }) {
  return (
    <div className="overflow-x-auto">
      <VirtualizedTable
        rows={requisitions}
        rowKey={(requisition) => requisition.id}
        rowHeight={64}
        columns={columns}
        onRowClick={(requisition) => onOpenRequisition(requisition.id)}
        rowClassName="hover:bg-muted/30"
        className="min-w-[960px]"
        headerClassName="bg-muted/50 border-b border-border"
      />
    </div>
  );
}

function RequisitionsEmptyState({ hasActiveFilters, onCreateRequisition }) {
  return (
    <div className="bg-card/50 border border-border rounded-2xl p-12 text-center">
      <div className="size-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
        <ClipboardList className="size-8 text-muted-foreground" />
      </div>
      <h3 className="font-display text-xl text-foreground mb-2">
        No Requisitions Found
      </h3>
      <p className="text-muted-foreground text-sm mb-4">
        {hasActiveFilters
          ? 'Try adjusting your filters'
          : 'Create your first requisition to get started'}
      </p>
      {!hasActiveFilters && (
        <Button onClick={onCreateRequisition} className="font-mono text-xs">
          <Plus className="size-4 mr-2" />
          New Requisition
        </Button>
      )}
    </div>
  );
}

function RequisitionsDisplay({
  requisitions,
  columns,
  hasActiveFilters,
  onOpenRequisition,
  onCreateRequisition,
}) {
  if (requisitions.length === 0) {
    return (
      <RequisitionsEmptyState
        hasActiveFilters={hasActiveFilters}
        onCreateRequisition={onCreateRequisition}
      />
    );
  }

  return (
    <RequisitionsTable
      requisitions={requisitions}
      columns={columns}
      onOpenRequisition={onOpenRequisition}
    />
  );
}

function RequisitionsPagination({ page, totalPages, totalCount, onPageChange }) {
  if (totalPages <= 1) {
    return null;
  }

  return (
    <div className="flex items-center justify-between pt-4 border-t border-border">
      <p className="font-mono text-xs text-muted-foreground">
        Page {page} of {totalPages} ({totalCount} requisitions)
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="font-mono text-xs"
        >
          <ChevronLeft className="size-4 mr-1" />
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="font-mono text-xs"
        >
          Next
          <ChevronRight className="size-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}

function CreateRequisitionSheet({ isOpen, initialItems, onClose, onCreateSuccess }) {
  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-display text-2xl">New Requisition</SheetTitle>
          <SheetDescription>
            Create a new purchase requisition for inventory items.
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          <RequisitionForm
            initialItems={initialItems}
            onSuccess={onCreateSuccess}
            onCancel={onClose}
          />
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

/**
 * RequisitionsPage - Purchase requisitions list page
 */
export default function RequisitionsPage() {
  const navigate = useNavigate();
  const {
    search,
    status,
    priority,
    action,
    initialItems,
    page,
    queryParams,
    hasActiveFilters,
    handleSearchChange,
    handleTabChange,
    handlePriorityChange,
    handlePageChange,
    clearFilters,
    setSearchParams,
  } = useRequisitionListFilters();
  const isCreateOpen = action === 'create';
  const { data: requisitionsData, isLoading, error, refetch } = useRequisitions(queryParams);
  const requisitions = requisitionsData?.results || [];
  const totalCount = requisitionsData?.count || 0;
  const totalPages = Math.ceil(totalCount / 20);

  const handleRequisitionClick = useCallback((requisitionId) => {
    navigate(`/inventory/requisitions/${requisitionId}`);
  }, [navigate]);
  const handleApprove = useCallback((requisitionId) => {
    navigate(`/inventory/requisitions/${requisitionId}?action=approve`);
  }, [navigate]);
  const handleReject = useCallback((requisitionId) => {
    navigate(`/inventory/requisitions/${requisitionId}?action=reject`);
  }, [navigate]);
  const handleConvertToPO = useCallback((requisitionId) => {
    navigate(`/inventory/purchase-orders?action=create&requisition=${requisitionId}`);
  }, [navigate]);
  const handleCreateRequisition = useCallback(() => {
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
      params.delete('items');
      return params;
    });
  }, [setSearchParams]);
  const handleCreateSuccess = useCallback(() => {
    handleCloseSheet();
    refetch();
  }, [handleCloseSheet, refetch]);
  const requisitionColumns = useMemo(() => createRequisitionColumns({
    onOpenRequisition: handleRequisitionClick,
    onApprove: handleApprove,
    onReject: handleReject,
    onConvertToPO: handleConvertToPO,
  }), [handleApprove, handleConvertToPO, handleReject, handleRequisitionClick]);

  if (isLoading && !requisitionsData) {
    return <RequisitionsLoadingState />;
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
      <RequisitionsHeader
        totalCount={totalCount}
        isLoading={isLoading}
        onRefresh={refetch}
        onCreateRequisition={handleCreateRequisition}
      />

      <div className="p-4 sm:p-6 space-y-6">
        <RequisitionStatusTabs status={status} onStatusChange={handleTabChange} />

        <RequisitionsFilters
          search={search}
          priority={priority}
          hasActiveFilters={hasActiveFilters}
          onSearchChange={handleSearchChange}
          onPriorityChange={handlePriorityChange}
          onClearFilters={clearFilters}
        />

        <RequisitionsDisplay
          requisitions={requisitions}
          columns={requisitionColumns}
          hasActiveFilters={hasActiveFilters}
          onOpenRequisition={handleRequisitionClick}
          onCreateRequisition={handleCreateRequisition}
        />

        <RequisitionsPagination
          page={page}
          totalPages={totalPages}
          totalCount={totalCount}
          onPageChange={handlePageChange}
        />

        <CreateRequisitionSheet
          isOpen={isCreateOpen}
          initialItems={initialItems}
          onClose={handleCloseSheet}
          onCreateSuccess={handleCreateSuccess}
        />
      </div>
    </PageShell>
  );
}
