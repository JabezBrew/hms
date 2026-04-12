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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  GRNCardSkeleton,
  GRNForm,
} from '@/components/inventory';
import { getStatusConfig } from '@/components/inventory/GRNCard';
import { useGRNs } from '@/features/inventory/hooks';
import { useDebounce } from '@/hooks/use-debounce';
import Search from 'lucide-react/dist/esm/icons/search.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import Package from 'lucide-react/dist/esm/icons/package.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import MoreHorizontal from 'lucide-react/dist/esm/icons/more-horizontal.js';
import Eye from 'lucide-react/dist/esm/icons/eye.js';
import ClipboardCheck from 'lucide-react/dist/esm/icons/clipboard-check.js';
import Check from 'lucide-react/dist/esm/icons/check.js';
import { format, parseISO } from 'date-fns';

const STATUS_TABS = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'pending_inspection', label: 'Pending Inspection' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'rejected', label: 'Rejected' },
];

/**
 * GRNsPage - Goods Received Notes list page
 */
export default function GRNsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Filters from URL
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const status = searchParams.get('status') || 'all';
  const page = parseInt(searchParams.get('page') || '1', 10);

  // Debounced search
  const debouncedSearch = useDebounce(search, 300);

  // Build query params
  const queryParams = {
    page,
    page_size: 20,
    ...(debouncedSearch && { search: debouncedSearch }),
    ...(status !== 'all' && { status }),
  };

  // Fetch data
  const {
    data: grnsData,
    isLoading,
    error,
    refetch,
  } = useGRNs(queryParams);

  const grns = grnsData?.results || [];
  const totalCount = grnsData?.count || 0;
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

  const hasActiveFilters = debouncedSearch || status !== 'all';

  // Navigate handlers
  const handleGRNClick = (grnId) => {
    navigate(`/inventory/grns/${grnId}`);
  };

  const handleInspect = (grnId) => {
    navigate(`/inventory/grns/${grnId}?action=inspect`);
  };

  const handleAccept = (grnId) => {
    navigate(`/inventory/grns/${grnId}?action=accept`);
  };

  const handleReject = (grnId) => {
    navigate(`/inventory/grns/${grnId}?action=reject`);
  };

  // Sheet state from URL
  const action = searchParams.get('action');
  const isCreateOpen = action === 'create';
  const initialPOId = searchParams.get('po') || '';

  const handleCreateGRN = () => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set('action', 'create');
      return params;
    });
  };

  const grnColumns = useMemo(() => ([
    {
      key: 'number',
      header: 'GRN #',
      width: '200px',
      render: (grn) => {
        const hasQualityIssues = grn.quality_issues_count > 0 || grn.has_issues;
        return (
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-muted-foreground" />
            <span className="font-mono text-sm font-medium text-primary">
              {grn.grn_number || grn.number}
            </span>
            {hasQualityIssues && (
              <AlertTriangle className="h-4 w-4 text-rose-500" />
            )}
          </div>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      width: '140px',
      render: (grn) => {
        const statusConfig = getStatusConfig(grn.status);
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
      key: 'po',
      header: 'PO #',
      width: '140px',
      render: (grn) => (
        grn.po_number ? (
          <span className="text-sm font-mono text-muted-foreground">{grn.po_number}</span>
        ) : (
          <span className="text-sm text-muted-foreground">-</span>
        )
      ),
    },
    {
      key: 'supplier',
      header: 'Supplier',
      width: '200px',
      render: (grn) => (
        <span className="text-sm truncate max-w-[150px] block">
          {grn.supplier_name || '-'}
        </span>
      ),
    },
    {
      key: 'received',
      header: 'Received',
      width: '160px',
      render: (grn) => (
        grn.received_date ? (
          <span className="text-sm font-mono">
            {format(parseISO(grn.received_date), 'MMM d, yyyy')}
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
      render: (grn) => (
        <span className="text-sm font-mono">
          {grn.items_count || grn.item_count || 0}
        </span>
      ),
    },
    {
      key: 'accepted',
      header: 'Accepted',
      width: '120px',
      headerClassName: 'text-center',
      cellClassName: 'text-center',
      render: (grn) => (
        <span className="text-sm font-mono text-emerald-500">
          {grn.accepted_count || 0}
          {grn.rejected_count > 0 && (
            <span className="text-sm font-mono text-rose-500 ml-1">
              / {grn.rejected_count}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: '64px',
      render: (grn) => {
        const canInspect = grn.status === 'pending_inspection';
        const canAccept = grn.status === 'inspecting' || grn.status === 'pending_inspection';
        const canReject = grn.status === 'inspecting' || grn.status === 'pending_inspection';

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(event) => event.stopPropagation()}>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={(event) => { event.stopPropagation(); handleGRNClick(grn.id); }}>
                <Eye className="h-4 w-4 mr-2" />
                View Details
              </DropdownMenuItem>
              {canInspect && (
                <DropdownMenuItem onClick={(event) => { event.stopPropagation(); handleInspect(grn.id); }}>
                  <ClipboardCheck className="h-4 w-4 mr-2" />
                  Start Inspection
                </DropdownMenuItem>
              )}
              {canAccept && (
                <DropdownMenuItem onClick={(event) => { event.stopPropagation(); handleAccept(grn.id); }}>
                  <Check className="h-4 w-4 mr-2" />
                  Accept
                </DropdownMenuItem>
              )}
              {canReject && (
                <DropdownMenuItem onClick={(event) => { event.stopPropagation(); handleReject(grn.id); }}>
                  <X className="h-4 w-4 mr-2" />
                  Reject
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ]), [
    handleAccept,
    handleGRNClick,
    handleInspect,
    handleReject,
  ]);

  const handleCloseSheet = () => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.delete('action');
      params.delete('po');
      return params;
    });
  };

  const handleCreateSuccess = () => {
    handleCloseSheet();
    refetch();
  };

  // Loading state (only show skeleton on initial load, not on refetches)
  if (isLoading && !grnsData) {
    return (
      <PageState variant="loading" fullHeight={false} className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-9 w-56" />
            <Skeleton className="h-5 w-32 mt-2" />
          </div>
          <Skeleton className="h-10 w-32" />
        </div>
        <Skeleton className="h-10 w-full max-w-xl" />
        <div className="flex gap-3">
          <Skeleton className="h-10 flex-1 max-w-md" />
        </div>
        <div className="space-y-3">
          {[...Array(6)].map((_, i) => (
            <GRNCardSkeleton key={i} />
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
        title="Error Loading GRNs"
        description={error.message}
        action={() => refetch()}
      />
    );
  }

  return (
    <PageShell>
      <PageHeader
        title="Goods Received Notes"
        description={`${totalCount} GRN${totalCount !== 1 ? 's' : ''}`}
        actions={(
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className={cn('h-4 w-4 mr-2', isLoading && 'animate-spin')} />
              Refresh
            </Button>
            <Button onClick={handleCreateGRN}>
              <Plus className="h-4 w-4 mr-2" />
              New GRN
            </Button>
          </div>
        )}
      />

      <div className="p-4 sm:p-6 space-y-6">

      {/* Status Tabs */}
      <Tabs value={status} onValueChange={handleTabChange}>
        <TabsList className="w-full sm:w-auto overflow-x-auto">
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
            placeholder="Search by GRN or PO number..."
            value={search}
            onChange={handleSearchChange}
            className="pl-9 font-mono text-sm"
          />
        </div>

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

      {/* GRNs Display */}
      {grns.length > 0 ? (
        <div className="overflow-x-auto">
          <VirtualizedTable
            rows={grns}
            rowKey={(grn) => grn.id}
            rowHeight={64}
            columns={grnColumns}
            onRowClick={(grn) => handleGRNClick(grn.id)}
            rowClassName="hover:bg-muted/30"
            className="min-w-[980px]"
            headerClassName="bg-muted/50 border-b border-border"
          />
        </div>
      ) : (
        <div className="bg-card/50 border border-border rounded-2xl p-12 text-center">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
            <Package className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="font-display text-xl text-foreground mb-2">
            No GRNs Found
          </h3>
          <p className="text-muted-foreground text-sm mb-4">
            {hasActiveFilters
              ? 'Try adjusting your filters'
              : 'Create a GRN when goods are received'}
          </p>
          {!hasActiveFilters && (
            <Button onClick={handleCreateGRN} className="font-mono text-xs">
              <Plus className="h-4 w-4 mr-2" />
              New GRN
            </Button>
          )}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-4 border-t border-border">
          <p className="font-mono text-xs text-muted-foreground">
            Page {page} of {totalPages} ({totalCount} GRNs)
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

      {/* Create GRN Sheet */}
      <Sheet open={isCreateOpen} onOpenChange={(open) => !open && handleCloseSheet()}>
        <SheetContent className="sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="font-display text-2xl">New Goods Received Note</SheetTitle>
            <SheetDescription>
              Record received goods into your inventory.
            </SheetDescription>
          </SheetHeader>
          <SheetBody>
            <GRNForm
              initialPOId={initialPOId}
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
