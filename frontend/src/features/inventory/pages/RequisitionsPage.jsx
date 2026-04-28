import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
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
import {
  RequisitionCardSkeleton,
} from '@/components/inventory/RequisitionCard';
import { getStatusConfig, getPriorityConfig, formatCurrency } from '@/components/inventory/RequisitionCard';
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

/**
 * RequisitionsPage - Purchase requisitions list page
 */
export default function RequisitionsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Filters from URL
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const status = searchParams.get('status') || 'all';
  const priority = searchParams.get('priority') || '';
  const page = parseInt(searchParams.get('page') || '1', 10);

  // Debounced search
  const debouncedSearch = useDebounce(search, 300);

  // Sheet state from URL
  const action = searchParams.get('action');
  const isCreateOpen = action === 'create';
  const initialItems = searchParams.get('items')?.split(',').filter(Boolean) || [];

  // Build query params
  const queryParams = {
    page,
    page_size: 20,
    ...(debouncedSearch && { search: debouncedSearch }),
    ...(status !== 'all' && { status }),
    ...(priority && priority !== 'all' && { priority }),
  };

  // Fetch data
  const {
    data: requisitionsData,
    isLoading,
    error,
    refetch,
  } = useRequisitions(queryParams);

  const requisitions = requisitionsData?.results || [];
  const totalCount = requisitionsData?.count || 0;
  const totalPages = Math.ceil(totalCount / 20);

  // Handle search input
  const handleSearchChange = (e) => {
    setSearch(e.target.value);
  };

  // Update search params when debounced search changes
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

  // Handle tab change
  const handleTabChange = (value) => {
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
  };

  // Handle filter changes
  const handlePriorityChange = (value) => {
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
  };

  const handlePageChange = (newPage) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set('page', newPage.toString());
      return params;
    });
  };

  // Clear all filters
  const clearFilters = () => {
    setSearch('');
    setSearchParams({});
  };

  const hasActiveFilters = debouncedSearch || status !== 'all' || priority;

  // Navigate handlers
  const handleRequisitionClick = (requisitionId) => {
    navigate(`/inventory/requisitions/${requisitionId}`);
  };

  const handleApprove = (requisitionId) => {
    navigate(`/inventory/requisitions/${requisitionId}?action=approve`);
  };

  const handleReject = (requisitionId) => {
    navigate(`/inventory/requisitions/${requisitionId}?action=reject`);
  };

  const handleConvertToPO = (requisitionId) => {
    navigate(`/inventory/purchase-orders?action=create&requisition=${requisitionId}`);
  };

  const handleCreateRequisition = () => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set('action', 'create');
      return params;
    });
  };

  const requisitionColumns = useMemo(() => ([
    {
      key: 'number',
      header: 'Requisition #',
      width: '200px',
      render: (requisition) => (
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-muted-foreground" />
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
        const statusConfig = getStatusConfig(requisition.status);
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
          {formatCurrency(requisition.total_amount || requisition.total)}
        </span>
      ),
    },
    {
      key: 'priority',
      header: 'Priority',
      width: '120px',
      render: (requisition) => {
        const priorityConfig = getPriorityConfig(requisition.priority);
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
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={(event) => { event.stopPropagation(); handleRequisitionClick(requisition.id); }}>
                <Eye className="h-4 w-4 mr-2" />
                View Details
              </DropdownMenuItem>
              {canApprove && (
                <DropdownMenuItem onClick={(event) => { event.stopPropagation(); handleApprove(requisition.id); }}>
                  <Check className="h-4 w-4 mr-2" />
                  Approve
                </DropdownMenuItem>
              )}
              {canReject && (
                <DropdownMenuItem onClick={(event) => { event.stopPropagation(); handleReject(requisition.id); }}>
                  <X className="h-4 w-4 mr-2" />
                  Reject
                </DropdownMenuItem>
              )}
              {canConvert && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={(event) => { event.stopPropagation(); handleConvertToPO(requisition.id); }}>
                    <FileText className="h-4 w-4 mr-2" />
                    Convert to PO
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ]), [
    handleApprove,
    handleConvertToPO,
    handleReject,
    handleRequisitionClick,
  ]);

  const handleCloseSheet = () => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.delete('action');
      params.delete('items');
      return params;
    });
  };

  const handleCreateSuccess = () => {
    handleCloseSheet();
    refetch();
  };

  // Loading state (only show skeleton on initial load, not on refetches)
  if (isLoading && !requisitionsData) {
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

  // Error state
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
        title="Purchase Requisitions"
        description={`${totalCount} requisition${totalCount !== 1 ? 's' : ''}`}
        actions={(
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className={cn('h-4 w-4 mr-2', isLoading && 'animate-spin')} />
              Refresh
            </Button>
            <Button onClick={handleCreateRequisition}>
              <Plus className="h-4 w-4 mr-2" />
              New Requisition
            </Button>
          </div>
        )}
      />

      <div className="p-4 sm:p-6 space-y-6">

      {/* Status Tabs */}
      <Tabs value={status} onValueChange={handleTabChange}>
        <TabsList className="w-full sm:w-auto">
          {STATUS_TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="font-mono text-xs">
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Filters Row */}
      <div className="flex flex-col lg:flex-row gap-3">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by number or requester..."
            value={search}
            onChange={handleSearchChange}
            className="pl-9 font-mono text-sm"
          />
        </div>

        {/* Priority Filter */}
        <Select value={priority || 'all'} onValueChange={handlePriorityChange}>
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

        {/* Clear Filters */}
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="font-mono text-xs text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4 mr-1" />
            Clear
          </Button>
        )}
      </div>

      {/* Requisitions Display */}
      {requisitions.length > 0 ? (
        <div className="overflow-x-auto">
          <VirtualizedTable
            rows={requisitions}
            rowKey={(requisition) => requisition.id}
            rowHeight={64}
            columns={requisitionColumns}
            onRowClick={(requisition) => handleRequisitionClick(requisition.id)}
            rowClassName="hover:bg-muted/30"
            className="min-w-[960px]"
            headerClassName="bg-muted/50 border-b border-border"
          />
        </div>
      ) : (
        <div className="bg-card/50 border border-border rounded-2xl p-12 text-center">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
            <ClipboardList className="h-8 w-8 text-muted-foreground" />
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
            <Button onClick={handleCreateRequisition} className="font-mono text-xs">
              <Plus className="h-4 w-4 mr-2" />
              New Requisition
            </Button>
          )}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-4 border-t border-border">
          <p className="font-mono text-xs text-muted-foreground">
            Page {page} of {totalPages} ({totalCount} requisitions)
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(page - 1)}
              disabled={page <= 1}
              className="font-mono text-xs"
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(page + 1)}
              disabled={page >= totalPages}
              className="font-mono text-xs"
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {/* Create Requisition Sheet */}
      <Sheet open={isCreateOpen} onOpenChange={(open) => !open && handleCloseSheet()}>
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
