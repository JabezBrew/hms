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
import { Checkbox } from '@/components/ui/checkbox';
import {
  InventoryItemCardSkeleton,
  InventoryItemForm,
  StockLevelBadge,
  ExpiryBadge,
} from '@/components/inventory';
import {
  useInventoryItems,
  useInventoryCategories,
  useSuppliers,
} from '@/features/inventory/hooks';
import { useDebounce } from '@/hooks/use-debounce';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import Search from 'lucide-react/dist/esm/icons/search.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import Filter from 'lucide-react/dist/esm/icons/funnel.js';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js';
import Package from 'lucide-react/dist/esm/icons/package.js';
import ArrowUpDown from 'lucide-react/dist/esm/icons/arrow-up-down.js';
import X from 'lucide-react/dist/esm/icons/x.js';
import Eye from 'lucide-react/dist/esm/icons/eye.js';
import Edit from 'lucide-react/dist/esm/icons/edit.js';
import ShoppingCart from 'lucide-react/dist/esm/icons/shopping-cart.js';
import MoreHorizontal from 'lucide-react/dist/esm/icons/more-horizontal.js';

const USD_CURRENCY_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

const TAB_OPTIONS = [
  { value: 'all', label: 'All Items' },
  { value: 'low_stock', label: 'Low Stock' },
  { value: 'out_of_stock', label: 'Out of Stock' },
  { value: 'expiring', label: 'Expiring Soon' },
];

const SORT_OPTIONS = [
  { value: 'name', label: 'Name (A-Z)' },
  { value: '-name', label: 'Name (Z-A)' },
  { value: '-total_stock', label: 'Stock (High to Low)' },
  { value: 'total_stock', label: 'Stock (Low to High)' },
  { value: '-unit_price', label: 'Price (High to Low)' },
  { value: 'unit_price', label: 'Price (Low to High)' },
  { value: '-updated_at', label: 'Recently Updated' },
];

const PAGE_SIZE_OPTIONS = [12, 24, 48, 96];

/**
 * ItemsPage - Inventory items catalog page
 */
export default function ItemsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const itemMutationsAvailable = !isRustV2ApiMode();

  // Filters from URL
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const tab = searchParams.get('status') || 'all';
  const category = searchParams.get('category') || '';
  const supplier = searchParams.get('supplier') || '';
  const location = searchParams.get('location') || '';
  const sortBy = searchParams.get('ordering') || '-updated_at';
  const page = parseInt(searchParams.get('page') || '1', 10);
  const pageSize = parseInt(searchParams.get('page_size') || '24', 10);

  // Selection state for bulk actions
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [selectAll, setSelectAll] = useState(false);

  // Sheet state from URL
  const action = searchParams.get('action');
  const isCreateOpen = itemMutationsAvailable && action === 'create';

  // Debounced search
  const debouncedSearch = useDebounce(search, 300);

  // Build query params
  const queryParams = {
    page,
    page_size: pageSize,
    ordering: sortBy,
    ...(debouncedSearch && { search: debouncedSearch }),
    ...(tab !== 'all' && { status: tab }),
    ...(category && { category }),
    ...(supplier && { supplier }),
    ...(location && { location }),
  };

  // Fetch data
  const {
    data: itemsData,
    isLoading,
    error,
    refetch,
  } = useInventoryItems(queryParams);

  const { data: categoriesData } = useInventoryCategories();
  const { data: suppliersData } = useSuppliers();

  const items = itemsData?.results || [];
  const totalCount = itemsData?.count || 0;
  const totalPages = Math.ceil(totalCount / pageSize);

  const categories = categoriesData?.results || categoriesData || [];
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
    setSelectedItems(new Set());
    setSelectAll(false);
  };

  // Handle filter changes
  const handleCategoryChange = (value) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (value && value !== 'all') {
        params.set('category', value);
      } else {
        params.delete('category');
      }
      params.set('page', '1');
      return params;
    });
  };

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

  const handleSortChange = (value) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set('ordering', value);
      return params;
    });
  };

  const handlePageSizeChange = (value) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set('page_size', value);
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
    setSearchParams({ ordering: sortBy });
    setSelectedItems(new Set());
    setSelectAll(false);
  };

  const hasActiveFilters = debouncedSearch || tab !== 'all' || category || supplier || location;

  // Selection handlers
  const toggleItemSelection = (itemId) => {
    setSelectedItems((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) {
        newSet.delete(itemId);
      } else {
        newSet.add(itemId);
      }
      return newSet;
    });
  };

  const handleSelectAll = () => {
    if (selectAll) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(items.map((item) => item.id)));
    }
    setSelectAll(!selectAll);
  };

  // Bulk actions
  const handleBulkReorder = () => {
    const itemIds = Array.from(selectedItems).join(',');
    navigate(`/inventory/requisitions?action=create&items=${itemIds}`);
  };

  // Navigate to item
  const handleItemClick = (itemId) => {
    navigate(`/inventory/items/${itemId}`);
  };

  const handleEditItem = (itemId) => {
    if (!itemMutationsAvailable) {
      return;
    }
    navigate(`/inventory/items/${itemId}?action=edit`);
  };

  const handleCreateItem = () => {
    if (!itemMutationsAvailable) {
      return;
    }
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set('action', 'create');
      return params;
    });
  };

  const itemColumns = useMemo(() => ([
    {
      key: 'select',
      header: (
        <Checkbox
          checked={selectAll}
          onCheckedChange={handleSelectAll}
          onClick={(event) => event.stopPropagation()}
        />
      ),
      width: '48px',
      render: (item) => (
        <div onClick={(event) => event.stopPropagation()}>
          <Checkbox
            checked={selectedItems.has(item.id)}
            onCheckedChange={() => toggleItemSelection(item.id)}
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      ),
    },
    {
      key: 'item',
      header: 'Item',
      width: '220px',
      render: (item) => (
        <div className="truncate">
          <span className="font-medium">{item.name}</span>
          {item.is_controlled && (
            <Badge className="ml-2 bg-purple-500 hover:bg-purple-600 text-white text-xs">
              Controlled
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: 'sku',
      header: 'SKU',
      width: '140px',
      render: (item) => (
        <span className="font-mono text-sm text-muted-foreground">{item.sku}</span>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      width: '160px',
      render: (item) => (
        item.category_name ? (
          <Badge variant="outline" className="text-xs">
            {item.category_name}
          </Badge>
        ) : (
          <span className="text-muted-foreground">-</span>
        )
      ),
    },
    {
      key: 'stock',
      header: 'Stock',
      width: '160px',
      render: (item) => (
        <StockLevelBadge
          stockLevel={item.total_stock || 0}
          reorderLevel={item.reorder_level}
          showQuantity={true}
        />
      ),
    },
    {
      key: 'expiry',
      header: 'Expiry',
      width: '140px',
      render: (item) => (
        item.nearest_expiry ? (
          <ExpiryBadge expiryDate={item.nearest_expiry} />
        ) : (
          <span className="text-muted-foreground text-sm">-</span>
        )
      ),
    },
    {
      key: 'price',
      header: 'Price',
      width: '160px',
      headerClassName: 'text-right',
      cellClassName: 'text-right',
      render: (item) => (
        <span className="font-mono">
          {USD_CURRENCY_FORMATTER.format(item.unit_price || 0)}
          <span className="text-muted-foreground text-xs ml-1">
            /{item.unit_of_measure || 'ea'}
          </span>
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: '64px',
      render: (item) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(event) => event.stopPropagation()}>
            <Button variant="ghost" size="icon" className="size-8">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={(event) => { event.stopPropagation(); handleItemClick(item.id); }}>
              <Eye className="size-4 mr-2" />
              View Details
            </DropdownMenuItem>
            {itemMutationsAvailable && (
              <DropdownMenuItem onClick={(event) => { event.stopPropagation(); handleEditItem(item.id); }}>
                <Edit className="size-4 mr-2" />
                Edit
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onClick={(event) => {
                event.stopPropagation();
                navigate(`/inventory/requisitions?action=create&items=${item.id}`);
              }}
            >
              <ShoppingCart className="size-4 mr-2" />
              Create Order
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]), [
    handleSelectAll,
    handleItemClick,
    handleEditItem,
    itemMutationsAvailable,
    navigate,
    selectAll,
    selectedItems,
    toggleItemSelection,
  ]);

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
  if (isLoading && !itemsData) {
    return (
      <PageState variant="loading" fullHeight={false} className="space-y-6">
        {/* Header skeleton */}
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-9 w-48" />
            <Skeleton className="h-5 w-32 mt-2" />
          </div>
          <Skeleton className="h-10 w-32" />
        </div>

        {/* Tabs skeleton */}
        <Skeleton className="h-10 w-full max-w-md" />

        {/* Filters skeleton */}
        <div className="flex gap-3">
          <Skeleton className="h-10 flex-1 max-w-md" />
          <Skeleton className="h-10 w-40" />
          <Skeleton className="h-10 w-40" />
        </div>

        {/* Grid skeleton */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => (
            <InventoryItemCardSkeleton key={i} />
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
        title="Error Loading Items"
        description={error.message}
        action={() => refetch()}
      />
    );
  }

  return (
    <PageShell>
      <PageHeader
        title="Inventory Items"
        description={`${totalCount} item${totalCount !== 1 ? 's' : ''} in catalog`}
        actions={(
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className={cn('size-4 mr-2', isLoading && 'animate-spin')} />
              Refresh
            </Button>
            {itemMutationsAvailable && (
              <Button onClick={handleCreateItem}>
                <Plus className="size-4 mr-2" />
                Add Item
              </Button>
            )}
          </div>
        )}
      />

      <div className="p-4 sm:p-6 space-y-6">
      {!itemMutationsAvailable && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Inventory item creation and editing is not available in Rust V2 mode yet. Existing
          item catalog review, stock levels, movement history, and requisition workflows remain
          available.
        </div>
      )}

      {/* Tabs */}
      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList className="w-full sm:w-auto">
          {TAB_OPTIONS.map((option) => (
            <TabsTrigger key={option.value} value={option.value} className="font-mono text-xs">
              {option.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Filters Row */}
      <div className="flex flex-col lg:flex-row gap-3">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, SKU, or description..."
            value={search}
            onChange={handleSearchChange}
            className="pl-9 font-mono text-sm"
          />
        </div>

        {/* Category Filter */}
        <Select value={category || 'all'} onValueChange={handleCategoryChange}>
          <SelectTrigger className="w-full lg:w-[180px] font-mono text-sm">
            <Filter className="size-4 mr-2 text-muted-foreground" />
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="font-mono text-sm">
              All Categories
            </SelectItem>
            {categories.map((cat) => (
              <SelectItem key={cat.id} value={cat.id.toString()} className="font-mono text-sm">
                {cat.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Supplier Filter */}
        <Select value={supplier || 'all'} onValueChange={handleSupplierChange}>
          <SelectTrigger className="w-full lg:w-[180px] font-mono text-sm">
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

        {/* Sort */}
        <Select value={sortBy} onValueChange={handleSortChange}>
          <SelectTrigger className="w-full lg:w-[180px] font-mono text-sm">
            <ArrowUpDown className="size-4 mr-2 text-muted-foreground" />
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((option) => (
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
            <X className="size-4 mr-1" />
            Clear
          </Button>
        )}
      </div>

      {/* View Toggle & Bulk Actions Row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {/* Select All */}
          {items.length > 0 && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="select-all"
                checked={selectAll}
                onCheckedChange={handleSelectAll}
              />
              <label htmlFor="select-all" className="text-sm text-muted-foreground cursor-pointer">
                Select all
              </label>
            </div>
          )}

          {/* Bulk Actions */}
          {selectedItems.size > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="font-mono text-xs">
                  {selectedItems.size} selected
                  <ChevronDown className="size-4 ml-2" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={handleBulkReorder} className="font-mono text-xs">
                  Create Requisition
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    setSelectedItems(new Set());
                    setSelectAll(false);
                  }}
                  className="font-mono text-xs text-muted-foreground"
                >
                  Clear Selection
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Page Size */}
          <Select value={pageSize.toString()} onValueChange={handlePageSizeChange}>
            <SelectTrigger className="w-[100px] font-mono text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((size) => (
                <SelectItem key={size} value={size.toString()} className="font-mono text-xs">
                  {size} / page
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

        </div>
      </div>

      {/* Items Display */}
      {items.length > 0 ? (
        <div className="overflow-x-auto">
          <VirtualizedTable
            rows={items}
            rowKey={(item) => item.id}
            rowHeight={64}
            columns={itemColumns}
            onRowClick={(item) => handleItemClick(item.id)}
            rowClassName="hover:bg-muted/50"
            getRowClassName={(item) => (selectedItems.has(item.id) ? 'bg-muted/30' : null)}
            className="min-w-[960px]"
            headerClassName="bg-muted/50 border-b border-border"
          />
        </div>
      ) : (
        <div className="bg-card/50 border border-border rounded-2xl p-12 text-center">
          <div className="size-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
            <Package className="size-8 text-muted-foreground" />
          </div>
          <h3 className="font-display text-xl text-foreground mb-2">
            No Items Found
          </h3>
          <p className="text-muted-foreground text-sm mb-4">
            {hasActiveFilters
              ? 'Try adjusting your filters'
              : 'Add your first inventory item to get started'}
          </p>
          {!hasActiveFilters && itemMutationsAvailable && (
            <Button onClick={handleCreateItem} className="font-mono text-xs">
              <Plus className="size-4 mr-2" />
              Add Item
            </Button>
          )}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-4 border-t border-border">
          <p className="font-mono text-xs text-muted-foreground">
            Page {page} of {totalPages} ({totalCount} items)
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handlePageChange(page - 1)}
              disabled={page <= 1}
              className="font-mono text-xs"
            >
              <ChevronLeft className="size-4 mr-1" />
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
              <ChevronRight className="size-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {/* Create Item Sheet */}
      <Sheet open={isCreateOpen} onOpenChange={(open) => !open && handleCloseSheet()}>
        <SheetContent className="sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="font-display text-2xl">Add Inventory Item</SheetTitle>
            <SheetDescription>
              Create a new item in your inventory catalog.
            </SheetDescription>
          </SheetHeader>
          <SheetBody>
            <InventoryItemForm
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
