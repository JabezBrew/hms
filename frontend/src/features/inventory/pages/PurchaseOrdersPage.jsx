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
import {
  POCardSkeleton,
  PurchaseOrderForm,
} from '@/components/inventory';
import { formatPOCurrency, getPOStatusConfig } from '@/components/inventory/po-card-utils';
import { InventoryPagination } from '@/features/inventory/components/InventoryPagination';
import { usePurchaseOrders, useSuppliers } from '@/features/inventory/hooks';
import { useDebounce } from '@/hooks/use-debounce';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import Search from 'lucide-react/dist/esm/icons/search.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import Filter from 'lucide-react/dist/esm/icons/funnel.js';
import MoreHorizontal from 'lucide-react/dist/esm/icons/more-horizontal.js';
import Eye from 'lucide-react/dist/esm/icons/eye.js';
import Send from 'lucide-react/dist/esm/icons/send.js';
import Package from 'lucide-react/dist/esm/icons/package.js';
import Printer from 'lucide-react/dist/esm/icons/printer.js';
import Building2 from 'lucide-react/dist/esm/icons/building-2.js';
import { format, parseISO } from 'date-fns';

const LEGACY_STATUS_TABS = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'sent', label: 'Sent' },
  { value: 'receiving', label: 'Receiving' },
  { value: 'closed', label: 'Closed' },
];

const RUST_V2_STATUS_TABS = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'approved', label: 'Approved' },
  { value: 'sent', label: 'Sent' },
  { value: 'ordered', label: 'Ordered' },
  { value: 'closed', label: 'Closed' },
];

function usePurchaseOrderListFilters({ statusTabs = LEGACY_STATUS_TABS } = {}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlSearch = searchParams.get('search') || '';
  const [search, setSearch] = useState(urlSearch);
  const rawStatus = searchParams.get('status') || 'all';
  const status = statusTabs.some((tab) => tab.value === rawStatus) ? rawStatus : 'all';
  const supplier = searchParams.get('supplier') || '';
  const action = searchParams.get('action');
  const initialRequisitionId = searchParams.get('requisition') || '';
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

  const handleSupplierChange = useCallback((value) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (value && value !== 'all') {
        params.set('supplier', value);
      } else {
        params.delete('supplier');
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
    ...(status !== 'all' && { status }),
    ...(supplier && { supplier }),
  }), [debouncedSearch, page, status, supplier]);

  return {
    search,
    status,
    supplier,
    action,
    initialRequisitionId,
    page,
    queryParams,
    hasActiveFilters: Boolean(debouncedSearch || status !== 'all' || supplier),
    handleSearchChange,
    handleTabChange,
    handleSupplierChange,
    handlePageChange,
    clearFilters,
    setSearchParams,
  };
}

function createPurchaseOrderColumns({ onOpenPO, onSend, onCreateGRN, onPrint }) {
  return [
    {
      key: 'number',
      header: 'PO #',
      width: '180px',
      render: (po) => (
        <div className="flex items-center gap-2">
          <FileText className="size-4 text-muted-foreground" />
          <span className="font-mono text-sm font-medium text-primary">
            {po.po_number || po.number}
          </span>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '140px',
      render: (po) => {
        const statusConfig = getPOStatusConfig(po.status);
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
      key: 'supplier',
      header: 'Supplier',
      width: '220px',
      render: (po) => (
        <div className="flex items-center gap-2">
          <Building2 className="size-4 text-muted-foreground" />
          <span className="text-sm truncate max-w-[200px]">
            {po.supplier_name || po.supplier}
          </span>
        </div>
      ),
    },
    {
      key: 'order_date',
      header: 'Order Date',
      width: '160px',
      render: (po) => (
        po.order_date ? (
          <span className="text-sm font-mono">
            {format(parseISO(po.order_date), 'MMM d, yyyy')}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">-</span>
        )
      ),
    },
    {
      key: 'expected',
      header: 'Expected',
      width: '160px',
      render: (po) => (
        po.expected_delivery_date ? (
          <span className="text-sm font-mono">
            {format(parseISO(po.expected_delivery_date), 'MMM d, yyyy')}
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
      render: (po) => (
        <span className="text-sm font-mono">
          {po.items_count || po.item_count || 0}
        </span>
      ),
    },
    {
      key: 'total',
      header: 'Total',
      width: '140px',
      headerClassName: 'text-right',
      cellClassName: 'text-right',
      render: (po) => (
        <span className="font-mono text-sm font-semibold text-emerald-500">
          {formatPOCurrency(po.total_amount || po.total)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: '64px',
      render: (po) => {
        const canSend = po.status === 'approved';
        const canCreateGRN = ['sent', 'acknowledged', 'receiving', 'partially_received'].includes(po.status);

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(event) => event.stopPropagation()}>
              <Button variant="ghost" size="sm" className="size-8 p-0">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={(event) => { event.stopPropagation(); onOpenPO(po.id); }}>
                <Eye className="size-4 mr-2" />
                View Details
              </DropdownMenuItem>
              {canSend && (
                <DropdownMenuItem onClick={(event) => { event.stopPropagation(); onSend(po.id); }}>
                  <Send className="size-4 mr-2" />
                  Send to Supplier
                </DropdownMenuItem>
              )}
              {canCreateGRN && (
                <DropdownMenuItem onClick={(event) => { event.stopPropagation(); onCreateGRN(po.id); }}>
                  <Package className="size-4 mr-2" />
                  Create GRN
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={(event) => { event.stopPropagation(); onPrint(); }}>
                <Printer className="size-4 mr-2" />
                Print
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];
}

function PurchaseOrdersLoadingState() {
  return (
    <PageState variant="loading" fullHeight={false} className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-5 w-32 mt-2" />
        </div>
        <Skeleton className="h-10 w-32" />
      </div>
      <Skeleton className="h-10 w-full max-w-2xl" />
      <div className="flex gap-3">
        <Skeleton className="h-10 flex-1 max-w-md" />
        <Skeleton className="h-10 w-40" />
      </div>
      <div className="space-y-3">
        {[...Array(6)].map((_, i) => (
          <POCardSkeleton key={i} />
        ))}
      </div>
    </PageState>
  );
}

function PurchaseOrdersHeader({ totalCount, isLoading, onRefresh, onCreatePO }) {
  return (
    <PageHeader
      title="Purchase Orders"
      description={`${totalCount} purchase order${totalCount !== 1 ? 's' : ''}`}
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
          <Button onClick={onCreatePO}>
            <Plus className="size-4 mr-2" />
            New PO
          </Button>
        </div>
      )}
    />
  );
}

function PurchaseOrderStatusTabs({ status, statusTabs, onStatusChange }) {
  return (
    <Tabs value={status} onValueChange={onStatusChange}>
      <TabsList className="w-full sm:w-auto overflow-x-auto">
        {statusTabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value} className="font-mono text-xs">
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

function PurchaseOrdersFilters({
  search,
  supplier,
  suppliers,
  useSupplierNameValue,
  hasActiveFilters,
  onSearchChange,
  onSupplierChange,
  onClearFilters,
}) {
  return (
    <div className="flex flex-col lg:flex-row gap-3">
      <div className="relative flex-1 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder="Search by PO number..."
          value={search}
          onChange={onSearchChange}
          className="pl-9 font-mono text-sm"
        />
      </div>

      <Select value={supplier || 'all'} onValueChange={onSupplierChange}>
        <SelectTrigger className="w-full lg:w-[200px] font-mono text-sm">
          <Filter className="size-4 mr-2 text-muted-foreground" />
          <SelectValue placeholder="Supplier" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all" className="font-mono text-sm">
            All Suppliers
          </SelectItem>
          {suppliers.map((sup) => (
            <SelectItem
              key={sup.id}
              value={useSupplierNameValue ? sup.name : sup.id.toString()}
              className="font-mono text-sm"
            >
              {sup.name}
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

function PurchaseOrdersTable({ purchaseOrders, columns, onOpenPO }) {
  return (
    <div className="overflow-x-auto">
      <VirtualizedTable
        rows={purchaseOrders}
        rowKey={(po) => po.id}
        rowHeight={64}
        columns={columns}
        onRowClick={(po) => onOpenPO(po.id)}
        rowClassName="hover:bg-muted/30"
        className="min-w-[980px]"
        headerClassName="bg-muted/50 border-b border-border"
      />
    </div>
  );
}

function PurchaseOrdersEmptyState({ hasActiveFilters, onCreatePO }) {
  return (
    <div className="bg-card/50 border border-border rounded-2xl p-12 text-center">
      <div className="size-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
        <FileText className="size-8 text-muted-foreground" />
      </div>
      <h3 className="font-display text-xl text-foreground mb-2">
        No Purchase Orders Found
      </h3>
      <p className="text-muted-foreground text-sm mb-4">
        {hasActiveFilters
          ? 'Try adjusting your filters'
          : 'Create your first purchase order to get started'}
      </p>
      {!hasActiveFilters && (
        <Button onClick={onCreatePO} className="font-mono text-xs">
          <Plus className="size-4 mr-2" />
          New PO
        </Button>
      )}
    </div>
  );
}

function PurchaseOrdersDisplay({
  purchaseOrders,
  columns,
  hasActiveFilters,
  onOpenPO,
  onCreatePO,
}) {
  if (purchaseOrders.length === 0) {
    return <PurchaseOrdersEmptyState hasActiveFilters={hasActiveFilters} onCreatePO={onCreatePO} />;
  }

  return (
    <PurchaseOrdersTable
      purchaseOrders={purchaseOrders}
      columns={columns}
      onOpenPO={onOpenPO}
    />
  );
}

function CreatePurchaseOrderSheet({ isOpen, initialRequisitionId, onClose, onCreateSuccess }) {
  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-display text-2xl">New Purchase Order</SheetTitle>
          <SheetDescription>
            Create a new purchase order for your suppliers.
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          <PurchaseOrderForm
            initialRequisitionId={initialRequisitionId}
            onSuccess={onCreateSuccess}
            onCancel={onClose}
          />
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

/**
 * PurchaseOrdersPage - Purchase orders list page
 */
export default function PurchaseOrdersPage() {
  const navigate = useNavigate();
  const rustV2Mode = isRustV2ApiMode();
  const statusTabs = rustV2Mode ? RUST_V2_STATUS_TABS : LEGACY_STATUS_TABS;
  const {
    search,
    status,
    supplier,
    action,
    initialRequisitionId,
    page,
    queryParams,
    hasActiveFilters,
    handleSearchChange,
    handleTabChange,
    handleSupplierChange,
    handlePageChange,
    clearFilters,
    setSearchParams,
  } = usePurchaseOrderListFilters({ statusTabs });
  const { data: posData, isLoading, error, refetch } = usePurchaseOrders(queryParams);
  const { data: suppliersData } = useSuppliers();
  const purchaseOrders = posData?.results || [];
  const totalCount = posData?.count || 0;
  const suppliers = suppliersData?.results || suppliersData || [];
  const isCreateOpen = action === 'create';

  const handlePOClick = useCallback((poId) => {
    navigate(`/inventory/purchase-orders/${poId}`);
  }, [navigate]);
  const handleSend = useCallback((poId) => {
    navigate(`/inventory/purchase-orders/${poId}?action=send`);
  }, [navigate]);
  const handleCreateGRN = useCallback((poId) => {
    navigate(`/inventory/grns?action=create&po=${poId}`);
  }, [navigate]);
  const handlePrint = useCallback(() => {
    window.print();
  }, []);
  const handleCreatePO = useCallback(() => {
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
      params.delete('requisition');
      return params;
    });
  }, [setSearchParams]);
  const handleCreateSuccess = useCallback(() => {
    handleCloseSheet();
    refetch();
  }, [handleCloseSheet, refetch]);
  const poColumns = useMemo(() => createPurchaseOrderColumns({
    onOpenPO: handlePOClick,
    onSend: handleSend,
    onCreateGRN: handleCreateGRN,
    onPrint: handlePrint,
  }), [handleCreateGRN, handlePOClick, handlePrint, handleSend]);

  if (isLoading && !posData) {
    return <PurchaseOrdersLoadingState />;
  }

  if (error) {
    return (
      <PageState
        variant="error"
        title="Error Loading Purchase Orders"
        description={error.message}
        action={() => refetch()}
      />
    );
  }

  return (
    <PageShell>
      <PurchaseOrdersHeader
        totalCount={totalCount}
        isLoading={isLoading}
        onRefresh={refetch}
        onCreatePO={handleCreatePO}
      />

      <div className="p-4 sm:p-6 space-y-6">
        <>
          <PurchaseOrderStatusTabs
            status={status}
            statusTabs={statusTabs}
            onStatusChange={handleTabChange}
          />

          <PurchaseOrdersFilters
            search={search}
            supplier={supplier}
            suppliers={suppliers}
            useSupplierNameValue={rustV2Mode}
            hasActiveFilters={hasActiveFilters}
            onSearchChange={handleSearchChange}
            onSupplierChange={handleSupplierChange}
            onClearFilters={clearFilters}
          />
        </>

        <PurchaseOrdersDisplay
          purchaseOrders={purchaseOrders}
          columns={poColumns}
          hasActiveFilters={hasActiveFilters}
          onOpenPO={handlePOClick}
          onCreatePO={handleCreatePO}
        />

        <InventoryPagination
          data={posData}
          itemLabel="purchase orders"
          page={page}
          pageSize={20}
          onPageChange={handlePageChange}
        />

        <CreatePurchaseOrderSheet
          isOpen={isCreateOpen}
          initialRequisitionId={initialRequisitionId}
          onClose={handleCloseSheet}
          onCreateSuccess={handleCreateSuccess}
        />
      </div>
    </PageShell>
  );
}
