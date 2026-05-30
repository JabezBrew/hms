import { useCallback, useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
const DEFAULT_PAGE_SIZE = 12;

function InventoryItemActionsMenu({
  item,
  itemMutationsAvailable,
  onViewItem,
  onEditItem,
  onCreateOrder,
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild onClick={(event) => event.stopPropagation()}>
        <Button variant="ghost" size="icon" className="size-8">
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={(event) => { event.stopPropagation(); onViewItem(item.id); }}>
          <Eye className="size-4 mr-2" />
          View Details
        </DropdownMenuItem>
        {itemMutationsAvailable && (
          <DropdownMenuItem onClick={(event) => { event.stopPropagation(); onEditItem(item.id); }}>
            <Edit className="size-4 mr-2" />
            Edit
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onClick={(event) => {
            event.stopPropagation();
            onCreateOrder(item.id);
          }}
        >
          <ShoppingCart className="size-4 mr-2" />
          Create Order
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function createItemColumns({
  selectAll,
  selectedItems,
  itemMutationsAvailable,
  onSelectAll,
  onToggleItemSelection,
  onViewItem,
  onEditItem,
  onCreateOrder,
}) {
  return [
    {
      key: 'select',
      header: (
        <Checkbox
          checked={selectAll}
          onCheckedChange={onSelectAll}
          onClick={(event) => event.stopPropagation()}
        />
      ),
      width: '48px',
      render: (item) => (
        <div onClick={(event) => event.stopPropagation()}>
          <Checkbox
            checked={selectedItems.has(item.id)}
            onCheckedChange={() => onToggleItemSelection(item.id)}
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
        <InventoryItemActionsMenu
          item={item}
          itemMutationsAvailable={itemMutationsAvailable}
          onViewItem={onViewItem}
          onEditItem={onEditItem}
          onCreateOrder={onCreateOrder}
        />
      ),
    },
  ];
}

function ItemsLoadingState() {
  return (
    <PageState variant="loading" fullHeight={false} className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-5 w-32 mt-2" />
        </div>
        <Skeleton className="h-10 w-32" />
      </div>

      <Skeleton className="h-10 w-full max-w-md" />

      <div className="flex gap-3">
        <Skeleton className="h-10 flex-1 max-w-md" />
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-10 w-40" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {[...Array(8)].map((_, i) => (
          <InventoryItemCardSkeleton key={i} />
        ))}
      </div>
    </PageState>
  );
}

function ItemsHeader({
  totalCount,
  isLoading,
  itemMutationsAvailable,
  onRefresh,
  onCreateItem,
}) {
  return (
    <PageHeader
      title="Inventory Items"
      description={`${totalCount} item${totalCount !== 1 ? 's' : ''} in catalog`}
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
          {itemMutationsAvailable && (
            <Button onClick={onCreateItem}>
              <Plus className="size-4 mr-2" />
              Add Item
            </Button>
          )}
        </div>
      )}
    />
  );
}

function RustV2InventoryNotice() {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      Inventory item creation and editing is not available in Rust V2 mode yet. Existing
      item catalog review, stock levels, movement history, and requisition workflows remain
      available.
    </div>
  );
}

function StatusTabs({ tab, onTabChange }) {
  return (
    <Tabs value={tab} onValueChange={onTabChange}>
      <TabsList className="w-full sm:w-auto">
        {TAB_OPTIONS.map((option) => (
          <TabsTrigger key={option.value} value={option.value} className="font-mono text-xs">
            {option.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}

function ItemsFilters({
  search,
  category,
  supplier,
  sortBy,
  categories,
  suppliers,
  hasActiveFilters,
  onSearchChange,
  onCategoryChange,
  onSupplierChange,
  onSortChange,
  onClearFilters,
}) {
  return (
    <div className="flex flex-col lg:flex-row gap-3">
      <div className="relative flex-1 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          placeholder="Search by name, SKU, or description..."
          value={search}
          onChange={onSearchChange}
          className="pl-9 font-mono text-sm"
        />
      </div>

      <Select value={category || 'all'} onValueChange={onCategoryChange}>
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

      <Select value={supplier || 'all'} onValueChange={onSupplierChange}>
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

      <Select value={sortBy} onValueChange={onSortChange}>
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

function ItemsBulkToolbar({
  items,
  selectedItems,
  selectAll,
  pageSize,
  onSelectAll,
  onBulkReorder,
  onClearSelection,
  onPageSizeChange,
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-4">
        {items.length > 0 && (
          <div className="flex items-center gap-2">
            <Checkbox
              id="select-all"
              checked={selectAll}
              onCheckedChange={onSelectAll}
            />
            <label htmlFor="select-all" className="text-sm text-muted-foreground cursor-pointer">
              Select all
            </label>
          </div>
        )}

        {selectedItems.size > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="font-mono text-xs">
                {selectedItems.size} selected
                <ChevronDown className="size-4 ml-2" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={onBulkReorder} className="font-mono text-xs">
                Create Requisition
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={onClearSelection}
                className="font-mono text-xs text-muted-foreground"
              >
                Clear Selection
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Select value={pageSize.toString()} onValueChange={onPageSizeChange}>
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
  );
}

function ItemsDisplay({
  items,
  itemColumns,
  selectedItems,
  hasActiveFilters,
  itemMutationsAvailable,
  onItemClick,
  onCreateItem,
}) {
  if (items.length > 0) {
    return (
      <div className="overflow-x-auto">
        <VirtualizedTable
          rows={items}
          rowKey={(item) => item.id}
          rowHeight={64}
          columns={itemColumns}
          onRowClick={(item) => onItemClick(item.id)}
          rowClassName="hover:bg-muted/50"
          getRowClassName={(item) => (selectedItems.has(item.id) ? 'bg-muted/30' : null)}
          className="min-w-[960px]"
          headerClassName="bg-muted/50 border-b border-border"
        />
      </div>
    );
  }

  return (
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
        <Button onClick={onCreateItem} className="font-mono text-xs">
          <Plus className="size-4 mr-2" />
          Add Item
        </Button>
      )}
    </div>
  );
}

function ItemsPagination({ page, totalPages, totalCount, onPageChange }) {
  if (totalPages <= 1) {
    return null;
  }

  return (
    <div className="flex items-center justify-between pt-4 border-t border-border">
      <p className="font-mono text-xs text-muted-foreground">
        Page {page} of {totalPages} ({totalCount} items)
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

function CreateItemSheet({ isOpen, onClose, onSuccess }) {
  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-display text-2xl">Add Inventory Item</SheetTitle>
          <SheetDescription>
            Create a new item in your inventory catalog.
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          <InventoryItemForm
            onSuccess={onSuccess}
            onCancel={onClose}
          />
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

function useInventoryItemsUrlState({ onClearSelection }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('search') || '');

  const tab = searchParams.get('status') || 'all';
  const category = searchParams.get('category') || '';
  const supplier = searchParams.get('supplier') || '';
  const location = searchParams.get('location') || '';
  const sortBy = searchParams.get('ordering') || '-updated_at';
  const page = parseInt(searchParams.get('page') || '1', 10);
  const pageSize = parseInt(searchParams.get('page_size') || String(DEFAULT_PAGE_SIZE), 10);
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

  const handleSearchChange = (event) => {
    setSearch(event.target.value);
  };

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
    onClearSelection();
  };

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

  const clearFilters = () => {
    setSearch('');
    setSearchParams({ ordering: sortBy });
    onClearSelection();
  };

  const openCreateAction = () => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set('action', 'create');
      return params;
    });
  };

  const closeAction = () => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.delete('action');
      return params;
    });
  };

  return {
    search,
    tab,
    category,
    supplier,
    location,
    sortBy,
    page,
    pageSize,
    debouncedSearch,
    queryParams: {
      page,
      page_size: pageSize,
      ordering: sortBy,
      ...(debouncedSearch && { search: debouncedSearch }),
      ...(tab !== 'all' && { status: tab }),
      ...(category && { category }),
      ...(supplier && { supplier }),
      ...(location && { location }),
    },
    hasActiveFilters: debouncedSearch || tab !== 'all' || category || supplier || location,
    isCreateAction: searchParams.get('action') === 'create',
    handleSearchChange,
    handleTabChange,
    handleCategoryChange,
    handleSupplierChange,
    handleSortChange,
    handlePageSizeChange,
    handlePageChange,
    clearFilters,
    openCreateAction,
    closeAction,
  };
}

/**
 * ItemsPage - Inventory items catalog page
 */
export default function ItemsPage() {
  const navigate = useNavigate();
  const itemMutationsAvailable = !isRustV2ApiMode();

  // Selection state for bulk actions
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [selectAll, setSelectAll] = useState(false);

  const handleClearSelection = useCallback(() => {
    setSelectedItems(new Set());
    setSelectAll(false);
  }, []);

  const {
    search,
    tab,
    category,
    supplier,
    sortBy,
    page,
    pageSize,
    queryParams,
    hasActiveFilters,
    isCreateAction,
    handleSearchChange,
    handleTabChange,
    handleCategoryChange,
    handleSupplierChange,
    handleSortChange,
    handlePageSizeChange,
    handlePageChange,
    clearFilters,
    openCreateAction,
    closeAction,
  } = useInventoryItemsUrlState({ onClearSelection: handleClearSelection });

  const isCreateOpen = itemMutationsAvailable && isCreateAction;

  // Fetch data
  const {
    data: itemsData,
    isLoading,
    error,
    refetch,
  } = useInventoryItems(queryParams);

  const { data: categoriesData } = useInventoryCategories();
  const { data: suppliersData } = useSuppliers();

  const items = useMemo(() => itemsData?.results || [], [itemsData]);
  const totalCount = itemsData?.count || 0;
  const totalPages = Math.ceil(totalCount / pageSize);

  const categories = categoriesData?.results || categoriesData || [];
  const suppliers = suppliersData?.results || suppliersData || [];

  // Selection handlers
  const toggleItemSelection = useCallback((itemId) => {
    setSelectedItems((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) {
        newSet.delete(itemId);
      } else {
        newSet.add(itemId);
      }
      return newSet;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (selectAll) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(items.map((item) => item.id)));
    }
    setSelectAll(!selectAll);
  }, [items, selectAll]);

  // Bulk actions
  const handleBulkReorder = () => {
    const itemIds = Array.from(selectedItems).join(',');
    navigate(`/inventory/requisitions?action=create&items=${itemIds}`);
  };

  // Navigate to item
  const handleItemClick = useCallback((itemId) => {
    navigate(`/inventory/items/${itemId}`);
  }, [navigate]);

  const handleEditItem = useCallback((itemId) => {
    if (!itemMutationsAvailable) {
      return;
    }
    navigate(`/inventory/items/${itemId}?action=edit`);
  }, [itemMutationsAvailable, navigate]);

  const handleCreateItem = () => {
    if (!itemMutationsAvailable) {
      return;
    }
    openCreateAction();
  };

  const handleCreateOrder = useCallback((itemId) => {
    navigate(`/inventory/requisitions?action=create&items=${itemId}`);
  }, [navigate]);

  const itemColumns = useMemo(() => createItemColumns({
    selectAll,
    selectedItems,
    itemMutationsAvailable,
    onSelectAll: handleSelectAll,
    onToggleItemSelection: toggleItemSelection,
    onViewItem: handleItemClick,
    onEditItem: handleEditItem,
    onCreateOrder: handleCreateOrder,
  }), [
    handleCreateOrder,
    handleSelectAll,
    handleItemClick,
    handleEditItem,
    itemMutationsAvailable,
    selectAll,
    selectedItems,
    toggleItemSelection,
  ]);

  const handleCloseSheet = () => {
    closeAction();
  };

  const handleCreateSuccess = () => {
    handleCloseSheet();
    refetch();
  };

  // Loading state (only show skeleton on initial load, not on refetches)
  if (isLoading && !itemsData) {
    return <ItemsLoadingState />;
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
    <PageShell data-perf-ready="inventory-items">
      <ItemsHeader
        totalCount={totalCount}
        isLoading={isLoading}
        itemMutationsAvailable={itemMutationsAvailable}
        onRefresh={refetch}
        onCreateItem={handleCreateItem}
      />

      <div className="p-4 sm:p-6 space-y-6">
        {!itemMutationsAvailable && <RustV2InventoryNotice />}

        <StatusTabs tab={tab} onTabChange={handleTabChange} />

        <ItemsFilters
          search={search}
          category={category}
          supplier={supplier}
          sortBy={sortBy}
          categories={categories}
          suppliers={suppliers}
          hasActiveFilters={hasActiveFilters}
          onSearchChange={handleSearchChange}
          onCategoryChange={handleCategoryChange}
          onSupplierChange={handleSupplierChange}
          onSortChange={handleSortChange}
          onClearFilters={clearFilters}
        />

        <ItemsBulkToolbar
          items={items}
          selectedItems={selectedItems}
          selectAll={selectAll}
          pageSize={pageSize}
          onSelectAll={handleSelectAll}
          onBulkReorder={handleBulkReorder}
          onClearSelection={handleClearSelection}
          onPageSizeChange={handlePageSizeChange}
        />

        <ItemsDisplay
          items={items}
          itemColumns={itemColumns}
          selectedItems={selectedItems}
          hasActiveFilters={hasActiveFilters}
          itemMutationsAvailable={itemMutationsAvailable}
          onItemClick={handleItemClick}
          onCreateItem={handleCreateItem}
        />

        <ItemsPagination
          page={page}
          totalPages={totalPages}
          totalCount={totalCount}
          onPageChange={handlePageChange}
        />

        <CreateItemSheet
          isOpen={isCreateOpen}
          onClose={handleCloseSheet}
          onSuccess={handleCreateSuccess}
        />
      </div>
    </PageShell>
  );
}
