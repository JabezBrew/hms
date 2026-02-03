import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
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
  POCard,
  POCardSkeleton,
  PORow,
  PORowSkeleton,
  PurchaseOrderForm,
} from '@/components/inventory';
import { usePurchaseOrders, useSuppliers } from '@/features/inventory/hooks';
import { useDebounce } from '@/hooks/use-debounce';
import Search from 'lucide-react/dist/esm/icons/search.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import LayoutGrid from 'lucide-react/dist/esm/icons/layout-grid.js';
import List from 'lucide-react/dist/esm/icons/list.js';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import FileText from 'lucide-react/dist/esm/icons/file-text.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import Filter from 'lucide-react/dist/esm/icons/funnel.js';

const STATUS_TABS = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'sent', label: 'Sent' },
  { value: 'receiving', label: 'Receiving' },
  { value: 'closed', label: 'Closed' },
];

/**
 * PurchaseOrdersPage - Purchase orders list page
 */
export default function PurchaseOrdersPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // View mode from localStorage
  const [viewMode, setViewMode] = useState(() => {
    return localStorage.getItem('po-view-mode') || 'list';
  });

  // Filters from URL
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const status = searchParams.get('status') || 'all';
  const supplier = searchParams.get('supplier') || '';
  const page = parseInt(searchParams.get('page') || '1', 10);

  // Debounced search
  const debouncedSearch = useDebounce(search, 300);

  // Persist view mode to localStorage
  useEffect(() => {
    localStorage.setItem('po-view-mode', viewMode);
  }, [viewMode]);

  // Build query params
  const queryParams = {
    page,
    page_size: 20,
    ...(debouncedSearch && { search: debouncedSearch }),
    ...(status !== 'all' && { status }),
    ...(supplier && { supplier }),
  };

  // Fetch data
  const {
    data: posData,
    isLoading,
    error,
    refetch,
  } = usePurchaseOrders(queryParams);

  const { data: suppliersData } = useSuppliers();

  const purchaseOrders = posData?.results || [];
  const totalCount = posData?.count || 0;
  const totalPages = Math.ceil(totalCount / 20);

  const suppliers = suppliersData?.results || suppliersData || [];

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
  const handleSupplierChange = (value) => {
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

  const hasActiveFilters = debouncedSearch || status !== 'all' || supplier;

  // Navigate handlers
  const handlePOClick = (poId) => {
    navigate(`/inventory/purchase-orders/${poId}`);
  };

  const handleSend = (poId) => {
    navigate(`/inventory/purchase-orders/${poId}?action=send`);
  };

  const handleCreateGRN = (poId) => {
    navigate(`/inventory/grns?action=create&po=${poId}`);
  };

  const handlePrint = (poId) => {
    // In a real app, this would open a print dialog
    window.print();
  };

  // Sheet state from URL
  const action = searchParams.get('action');
  const isCreateOpen = action === 'create';
  const initialRequisitionId = searchParams.get('requisition') || '';

  const handleCreatePO = () => {
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
      params.delete('requisition');
      return params;
    });
  };

  const handleCreateSuccess = () => {
    handleCloseSheet();
    refetch();
  };

  // Loading state (only show skeleton on initial load, not on refetches)
  if (isLoading && !posData) {
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

  // Error state
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
      <PageHeader
        title="Purchase Orders"
        description={`${totalCount} purchase order${totalCount !== 1 ? 's' : ''}`}
        actions={(
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className={cn('h-4 w-4 mr-2', isLoading && 'animate-spin')} />
              Refresh
            </Button>
            <Button onClick={handleCreatePO}>
              <Plus className="h-4 w-4 mr-2" />
              New PO
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
            placeholder="Search by PO number..."
            value={search}
            onChange={handleSearchChange}
            className="pl-9 font-mono text-sm"
          />
        </div>

        {/* Supplier Filter */}
        <Select value={supplier || 'all'} onValueChange={handleSupplierChange}>
          <SelectTrigger className="w-full lg:w-[200px] font-mono text-sm">
            <Filter className="h-4 w-4 mr-2 text-muted-foreground" />
            <SelectValue placeholder="Supplier" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="font-mono text-sm">
              All Suppliers
            </SelectItem>
            {suppliers.map((sup) => (
              <SelectItem key={sup.id} value={sup.id.toString()} className="font-mono text-sm">
                {sup.name}
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

      {/* View Toggle */}
      <div className="flex items-center justify-end">
        <div className="flex items-center border rounded-lg p-1 bg-muted/30">
          <Button
            variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('grid')}
            className="h-8 w-8 p-0"
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === 'list' ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setViewMode('list')}
            className="h-8 w-8 p-0"
          >
            <List className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Purchase Orders Display */}
      {purchaseOrders.length > 0 ? (
        viewMode === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {purchaseOrders.map((po, index) => (
              <POCard
                key={po.id}
                po={po}
                index={index}
                onClick={() => handlePOClick(po.id)}
                onSend={() => handleSend(po.id)}
                onCreateGRN={() => handleCreateGRN(po.id)}
                onPrint={() => handlePrint(po.id)}
              />
            ))}
          </div>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden bg-card/30">
            <table className="w-full">
              <thead className="bg-muted/50 border-b border-border">
                <tr>
                  <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">
                    PO #
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">
                    Status
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">
                    Supplier
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider hidden md:table-cell">
                    Order Date
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider hidden lg:table-cell">
                    Expected
                  </th>
                  <th className="text-center px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">
                    Items
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-mono text-muted-foreground uppercase tracking-wider">
                    Total
                  </th>
                  <th className="w-10 px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {purchaseOrders.map((po, index) => (
                  <PORow
                    key={po.id}
                    po={po}
                    index={index}
                    onClick={() => handlePOClick(po.id)}
                    onSend={() => handleSend(po.id)}
                    onCreateGRN={() => handleCreateGRN(po.id)}
                    onPrint={() => handlePrint(po.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        <div className="bg-card/50 border border-border rounded-2xl p-12 text-center">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
            <FileText className="h-8 w-8 text-muted-foreground" />
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
            <Button onClick={handleCreatePO} className="font-mono text-xs">
              <Plus className="h-4 w-4 mr-2" />
              New PO
            </Button>
          )}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-4 border-t border-border">
          <p className="font-mono text-xs text-muted-foreground">
            Page {page} of {totalPages} ({totalCount} purchase orders)
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

      {/* Create Purchase Order Sheet */}
      <Sheet open={isCreateOpen} onOpenChange={(open) => !open && handleCloseSheet()}>
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
