import { useCallback, useState, useEffect, useMemo } from 'react';
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
import { getGRNStatusConfig } from '@/components/inventory/grn-card-utils';
import { useGRNs } from '@/features/inventory/hooks';
import { useDebounce } from '@/hooks/use-debounce';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
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
function useGRNFilters() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const status = searchParams.get('status') || 'all';
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

  const queryParams = useMemo(() => ({
    page,
    page_size: 20,
    ...(debouncedSearch && { search: debouncedSearch }),
    ...(status !== 'all' && { status }),
  }), [debouncedSearch, page, status]);

  return {
    search,
    status,
    page,
    queryParams,
    hasActiveFilters: Boolean(debouncedSearch || status !== 'all'),
    handleSearchChange: (event) => setSearch(event.target.value),
    handleTabChange,
    handlePageChange,
    clearFilters,
  };
}

function GRNsLoadingState() {
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

function GRNsHeader({ totalCount, isLoading, onRefresh, onCreateGRN }) {
  return (
    <PageHeader
      title="Goods Received Notes"
      description={`${totalCount} GRN${totalCount !== 1 ? 's' : ''}`}
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
          <Button onClick={onCreateGRN}>
            <Plus className="size-4 mr-2" />
            New GRN
          </Button>
        </div>
      )}
    />
  );
}

function RustV2GRNNotice({ grnRejectionAvailable }) {
  if (grnRejectionAvailable) {
    return null;
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      GRN rejection is not available in Rust V2 mode yet. GRN creation, inspection, and
      acceptance remain available through generated /api/v2 contracts.
    </div>
  );
}

function GRNStatusTabs({ status, onTabChange }) {
  return (
    <Tabs value={status} onValueChange={onTabChange}>
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

function GRNFilters({ search, hasActiveFilters, onSearchChange, onClearFilters }) {
  return (
    <div className="flex flex-col lg:flex-row gap-3">
      <div className="relative flex-1 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder="Search by GRN or PO number..."
          value={search}
          onChange={onSearchChange}
          className="pl-9 font-mono text-sm"
        />
      </div>

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

function createGRNColumns({
  grnRejectionAvailable,
  onOpenGRN,
  onInspectGRN,
  onAcceptGRN,
  onRejectGRN,
}) {
  return [
    {
      key: 'number',
      header: 'GRN #',
      width: '200px',
      render: (grn) => {
        const hasQualityIssues = grn.quality_issues_count > 0 || grn.has_issues;
        return (
          <div className="flex items-center gap-2">
            <Package className="size-4 text-muted-foreground" />
            <span className="font-mono text-sm font-medium text-primary">
              {grn.grn_number || grn.number}
            </span>
            {hasQualityIssues && (
              <AlertTriangle className="size-4 text-rose-500" />
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
        const statusConfig = getGRNStatusConfig(grn.status);
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
        const canReject = grnRejectionAvailable && (
          grn.status === 'inspecting' || grn.status === 'pending_inspection'
        );
        const grnNumber = grn.grn_number || grn.number || 'GRN';

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(event) => event.stopPropagation()}>
              <Button
                variant="ghost"
                size="sm"
                className="size-8 p-0"
                aria-label={`Actions for ${grnNumber}`}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={(event) => { event.stopPropagation(); onOpenGRN(grn.id); }}>
                <Eye className="size-4 mr-2" />
                View Details
              </DropdownMenuItem>
              {canInspect && (
                <DropdownMenuItem onClick={(event) => { event.stopPropagation(); onInspectGRN(grn.id); }}>
                  <ClipboardCheck className="size-4 mr-2" />
                  Start Inspection
                </DropdownMenuItem>
              )}
              {canAccept && (
                <DropdownMenuItem onClick={(event) => { event.stopPropagation(); onAcceptGRN(grn.id); }}>
                  <Check className="size-4 mr-2" />
                  Accept
                </DropdownMenuItem>
              )}
              {canReject && (
                <DropdownMenuItem onClick={(event) => { event.stopPropagation(); onRejectGRN(grn.id); }}>
                  <X className="size-4 mr-2" />
                  Reject
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];
}

function GRNsTable({ grns, columns, hasActiveFilters, onOpenGRN, onCreateGRN }) {
  if (grns.length === 0) {
    return (
      <div className="bg-card/50 border border-border rounded-2xl p-12 text-center">
        <div className="size-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
          <Package className="size-8 text-muted-foreground" />
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
          <Button onClick={onCreateGRN} className="font-mono text-xs">
            <Plus className="size-4 mr-2" />
            New GRN
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <VirtualizedTable
        rows={grns}
        rowKey={(grn) => grn.id}
        rowHeight={64}
        columns={columns}
        onRowClick={(grn) => onOpenGRN(grn.id)}
        rowClassName="hover:bg-muted/30"
        className="min-w-[980px]"
        headerClassName="bg-muted/50 border-b border-border"
      />
    </div>
  );
}

function GRNsPagination({ page, totalPages, totalCount, onPageChange }) {
  if (totalPages <= 1) {
    return null;
  }

  return (
    <div className="flex items-center justify-between pt-4 border-t border-border">
      <p className="font-mono text-xs text-muted-foreground">
        Page {page} of {totalPages} ({totalCount} GRNs)
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

function CreateGRNSheet({ isOpen, initialPOId, onClose, onCreateSuccess }) {
  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
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
            onSuccess={onCreateSuccess}
            onCancel={onClose}
          />
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

export default function GRNsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const grnRejectionAvailable = !isRustV2ApiMode();
  const {
    search,
    status,
    page,
    queryParams,
    hasActiveFilters,
    handleSearchChange,
    handleTabChange,
    handlePageChange,
    clearFilters,
  } = useGRNFilters();

  const {
    data: grnsData,
    isLoading,
    error,
    refetch,
  } = useGRNs(queryParams);

  const grns = grnsData?.results || [];
  const totalCount = grnsData?.count || 0;
  const totalPages = Math.ceil(totalCount / 20);
  const action = searchParams.get('action');
  const isCreateOpen = action === 'create';
  const initialPOId = searchParams.get('po') || '';

  const handleGRNClick = useCallback((grnId) => {
    navigate(`/inventory/grns/${grnId}`);
  }, [navigate]);

  const handleInspect = useCallback((grnId) => {
    navigate(`/inventory/grns/${grnId}?action=inspect`);
  }, [navigate]);

  const handleAccept = useCallback((grnId) => {
    navigate(`/inventory/grns/${grnId}?action=accept`);
  }, [navigate]);

  const handleReject = useCallback((grnId) => {
    navigate(`/inventory/grns/${grnId}?action=reject`);
  }, [navigate]);

  const handleCreateGRN = () => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set('action', 'create');
      return params;
    });
  };

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

  const grnColumns = useMemo(() => createGRNColumns({
    grnRejectionAvailable,
    onOpenGRN: handleGRNClick,
    onInspectGRN: handleInspect,
    onAcceptGRN: handleAccept,
    onRejectGRN: handleReject,
  }), [
    grnRejectionAvailable,
    handleAccept,
    handleGRNClick,
    handleInspect,
    handleReject,
  ]);

  if (isLoading && !grnsData) {
    return <GRNsLoadingState />;
  }

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
      <GRNsHeader
        totalCount={totalCount}
        isLoading={isLoading}
        onRefresh={refetch}
        onCreateGRN={handleCreateGRN}
      />

      <div className="p-4 sm:p-6 space-y-6">
        <RustV2GRNNotice grnRejectionAvailable={grnRejectionAvailable} />

        <GRNStatusTabs status={status} onTabChange={handleTabChange} />

        <GRNFilters
          search={search}
          hasActiveFilters={hasActiveFilters}
          onSearchChange={handleSearchChange}
          onClearFilters={clearFilters}
        />

        <GRNsTable
          grns={grns}
          columns={grnColumns}
          hasActiveFilters={hasActiveFilters}
          onOpenGRN={handleGRNClick}
          onCreateGRN={handleCreateGRN}
        />

        <GRNsPagination
          page={page}
          totalPages={totalPages}
          totalCount={totalCount}
          onPageChange={handlePageChange}
        />

        <CreateGRNSheet
          isOpen={isCreateOpen}
          initialPOId={initialPOId}
          onClose={handleCloseSheet}
          onCreateSuccess={handleCreateSuccess}
        />
      </div>
    </PageShell>
  );
}
