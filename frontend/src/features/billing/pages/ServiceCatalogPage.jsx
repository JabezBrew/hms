/* oxlint-disable react-doctor/prefer-useReducer -- These components keep independent UI states; a reducer would add dispatch indirection without a shared transition invariant. */
import Layers from 'lucide-react/dist/esm/icons/layers.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import Search from 'lucide-react/dist/esm/icons/search.js';
import Pencil from 'lucide-react/dist/esm/icons/square-pen.js';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { useDebounce } from '@/hooks/use-debounce';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageState } from '@/shared/components/page/PageState';
import { useRouteTableState } from '@/shared/hooks/useRouteTableState';
import { VirtualizedTable } from '@/components/ui/VirtualizedTable';
import { TablePagination } from '@/components/ui/table-pagination';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import {
  useServiceCategories,
  useCreateServiceCategory,
  useUpdateServiceCategory,
  useServices,
  useCreateService,
  useUpdateService,
} from '@/features/billing/hooks';

const GHS_CURRENCY_FORMATTER = new Intl.NumberFormat('en-GH', {
  style: 'currency',
  currency: 'GHS',
  minimumFractionDigits: 2,
});

function normalizeResults(data) {
  if (!data) return { results: [], count: 0 };
  if (Array.isArray(data)) return { results: data, count: data.length };
  return { results: data.results || [], count: data.count || (data.results ? data.results.length : 0) };
}

function CatalogStatusBadge({ isActive }) {
  return (
    <span className={cn(
      'font-mono text-xs px-2 py-1 rounded',
      isActive ? 'badge-chronicle-emerald' : 'bg-muted text-muted-foreground'
    )}>
      {isActive ? 'Active' : 'Inactive'}
    </span>
  );
}

function createCategoryColumns({ catalogMutationsAvailable, onEditCategory }) {
  return [
    {
      key: 'name',
      header: 'Category',
      width: '260px',
      render: (row) => (
        <div>
          <p className="text-foreground font-medium">{row.name}</p>
          {row.description ? (
            <p className="text-xs text-muted-foreground line-clamp-1">{row.description}</p>
          ) : null}
        </div>
      ),
    },
    {
      key: 'is_active',
      header: 'Status',
      width: '120px',
      render: (row) => <CatalogStatusBadge isActive={row.is_active} />,
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '140px',
      headerClassName: 'text-right',
      cellClassName: 'text-right',
      render: (row) => (
        catalogMutationsAvailable ? (
          <Button
            variant="outline"
            size="sm"
            className="font-mono text-xs"
            onClick={() => onEditCategory(row)}
          >
            <Pencil className="size-3 mr-2" />
            Edit
          </Button>
        ) : null
      ),
    },
  ];
}

function createServiceColumns({ catalogMutationsAvailable, onEditService }) {
  return [
    {
      key: 'code',
      header: 'Code',
      width: '160px',
      render: (row) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.code || '—'}
        </span>
      ),
    },
    {
      key: 'name',
      header: 'Service',
      width: '320px',
      render: (row) => (
        <div>
          <p className="text-foreground font-medium">{row.name}</p>
          <p className="text-xs text-muted-foreground">
            {row.category_name || 'Uncategorized'}
          </p>
        </div>
      ),
    },
    {
      key: 'base_price',
      header: 'Base Price',
      width: '150px',
      headerClassName: 'text-right',
      cellClassName: 'text-right',
      render: (row) => (
        <span className="font-mono text-sm text-foreground">
          {formatCurrency(row.base_price)}
        </span>
      ),
    },
    {
      key: 'is_active',
      header: 'Status',
      width: '120px',
      render: (row) => <CatalogStatusBadge isActive={row.is_active} />,
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '140px',
      headerClassName: 'text-right',
      cellClassName: 'text-right',
      render: (row) => (
        catalogMutationsAvailable ? (
          <Button
            variant="outline"
            size="sm"
            className="font-mono text-xs"
            onClick={() => onEditService(row)}
          >
            <Pencil className="size-3 mr-2" />
            Edit
          </Button>
        ) : null
      ),
    },
  ];
}

function ServiceCatalogHeader({
  catalogMutationsAvailable,
  onNewCategory,
  onNewService,
  onRefresh,
  tab,
}) {
  return (
    <PageHeader
      title={(
        <span className="flex items-center gap-3">
          <span className="p-3 rounded-xl bg-primary/10">
            <Layers className="size-6 text-primary" />
          </span>
          Service Catalog
        </span>
      )}
      description="Manage billable services, categories, and base pricing"
      actions={(
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="font-mono text-xs"
            onClick={onRefresh}
          >
            <RefreshCw className="size-4 mr-2" />
            Refresh
          </Button>
          {catalogMutationsAvailable && tab === 'categories' ? (
            <Button
              size="sm"
              className="font-mono text-xs"
              onClick={onNewCategory}
            >
              <Plus className="size-4 mr-2" />
              New Category
            </Button>
          ) : null}
          {catalogMutationsAvailable && tab !== 'categories' ? (
            <Button
              size="sm"
              className="font-mono text-xs"
              onClick={onNewService}
            >
              <Plus className="size-4 mr-2" />
              New Service
            </Button>
          ) : null}
        </div>
      )}
    />
  );
}

function ServiceCatalogReadOnlyNotice() {
  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
      Service catalog editing is not available in Rust V2 mode yet. The catalog is
      read-only until service and category mutation contracts are implemented.
    </section>
  );
}

function ServicesTab({
  activeFilter,
  serviceColumns,
  serviceData,
  serviceSearch,
  services,
  targetServiceId,
  setServicePage,
  setActiveFilter,
  setServiceSearch,
}) {
  const servicePage = Number(serviceData?.page || 1);
  const serviceCount = Number(serviceData?.count || services.length);
  const servicePageSize = Number(serviceData?.page_size || 25);
  const serviceCountExact = serviceData?.count_exact !== false && serviceData?.total_is_lower_bound !== true;

  return (
    <TabsContent value="services" className="mt-4 space-y-3">
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 max-w-xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={serviceSearch}
            onChange={(event) => setServiceSearch(event.target.value)}
            placeholder="Search services (name, code, category)"
            className="pl-9 font-mono text-sm"
          />
        </div>
        <Select value={activeFilter} onValueChange={setActiveFilter}>
          <SelectTrigger className="w-full sm:w-[180px] font-mono text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active" className="font-mono text-sm">Active Only</SelectItem>
            <SelectItem value="all" className="font-mono text-sm">All</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <VirtualizedTable
        columns={serviceColumns}
        getRowClassName={(service) => (
          service.id === targetServiceId ? 'ring-2 ring-primary/50 bg-primary/5' : undefined
        )}
        rowKey={(service) => service.id}
        rows={services}
        threshold={50}
        className="rounded-2xl border border-border bg-card"
      />

      <TablePagination
        currentPage={servicePage}
        totalCount={serviceCount}
        pageSize={servicePageSize}
        countExact={serviceCountExact}
        totalPages={serviceData?.total_pages}
        hasNextPage={Boolean(serviceData?.next)}
        hasPrevPage={servicePage > 1}
        canJumpToPage={false}
        onPageChange={setServicePage}
        itemLabel="services"
      />
    </TabsContent>
  );
}

function CategoriesTab({
  categories,
  categoryColumns,
  categorySearch,
  setCategorySearch,
}) {
  return (
    <TabsContent value="categories" className="mt-4 space-y-3">
      <div className="relative flex-1 max-w-xl">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input
          value={categorySearch}
          onChange={(event) => setCategorySearch(event.target.value)}
          placeholder="Search categories"
          className="pl-9 font-mono text-sm"
        />
      </div>

      <VirtualizedTable
        columns={categoryColumns}
        rows={categories}
        threshold={50}
        className="rounded-2xl border border-border bg-card"
      />
    </TabsContent>
  );
}

function CategoryDialog({
  categoryDialog,
  categoryForm,
  createCategoryMutation,
  onCategoryDialogChange,
  onCategoryFormChange,
  onSaveCategory,
  updateCategoryMutation,
}) {
  return (
    <Dialog open={categoryDialog.open} onOpenChange={onCategoryDialogChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">
            {categoryDialog.mode === 'create' ? 'New Category' : 'Edit Category'}
          </DialogTitle>
          <DialogDescription>
            Categories help keep services organized (consultation, lab, imaging, pharmacy).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="font-mono text-xs uppercase tracking-wider">Name</Label>
            <Input
              value={categoryForm.name}
              onChange={(event) => onCategoryFormChange((prev) => ({ ...prev, name: event.target.value }))}
              className="font-mono"
            />
          </div>
          <div className="space-y-2">
            <Label className="font-mono text-xs uppercase tracking-wider">Description</Label>
            <Input
              value={categoryForm.description}
              onChange={(event) => onCategoryFormChange((prev) => ({ ...prev, description: event.target.value }))}
              className="font-mono"
            />
          </div>
          <div className="flex items-center justify-between rounded-xl border border-border bg-muted/20 p-3">
            <div>
              <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider">Status</p>
              <p className="text-sm text-foreground">{categoryForm.is_active ? 'Active' : 'Inactive'}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="font-mono text-xs"
              onClick={() => onCategoryFormChange((prev) => ({ ...prev, is_active: !prev.is_active }))}
            >
              Toggle
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            className="font-mono text-xs"
            onClick={() => onCategoryDialogChange(false)}
          >
            Cancel
          </Button>
          <Button
            className="font-mono text-xs"
            disabled={createCategoryMutation.isPending || updateCategoryMutation.isPending}
            onClick={onSaveCategory}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ServiceDialog({
  categories,
  createServiceMutation,
  onSaveService,
  onServiceDialogChange,
  onServiceFormChange,
  serviceDialog,
  serviceForm,
  updateServiceMutation,
}) {
  return (
    <Dialog open={serviceDialog.open} onOpenChange={onServiceDialogChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">
            {serviceDialog.mode === 'create' ? 'New Service' : 'Edit Service'}
          </DialogTitle>
          <DialogDescription>
            Services are billable items used on invoices. Keep `code` stable for NHIS mapping.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase tracking-wider">Code</Label>
              <Input
                value={serviceForm.code}
                onChange={(event) => onServiceFormChange((prev) => ({ ...prev, code: event.target.value }))}
                className="font-mono"
                placeholder="e.g. LAB-FBC"
              />
            </div>
            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase tracking-wider">Category</Label>
              <Select
                value={serviceForm.category}
                onValueChange={(value) => onServiceFormChange((prev) => ({ ...prev, category: value }))}
              >
                <SelectTrigger className="font-mono text-sm">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.reduce((activeCategories, category) => {
                    if (category.is_active) {
                      activeCategories.push(
                        <SelectItem key={category.id} value={category.id} className="font-mono text-sm">
                          {category.name}
                        </SelectItem>
                      );
                    }
                    return activeCategories;
                  }, [])}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="font-mono text-xs uppercase tracking-wider">Name</Label>
            <Input
              value={serviceForm.name}
              onChange={(event) => onServiceFormChange((prev) => ({ ...prev, name: event.target.value }))}
              className="font-mono"
            />
          </div>
          <div className="space-y-2">
            <Label className="font-mono text-xs uppercase tracking-wider">Description</Label>
            <Input
              value={serviceForm.description}
              onChange={(event) => onServiceFormChange((prev) => ({ ...prev, description: event.target.value }))}
              className="font-mono"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase tracking-wider">Base Price (GHS)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={serviceForm.base_price}
                onChange={(event) => onServiceFormChange((prev) => ({ ...prev, base_price: event.target.value }))}
                className="font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase tracking-wider">Tax Rate (%)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={serviceForm.tax_rate}
                onChange={(event) => onServiceFormChange((prev) => ({ ...prev, tax_rate: event.target.value }))}
                className="font-mono"
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-border bg-muted/20 p-3">
            <div>
              <p className="font-mono text-xs text-muted-foreground uppercase tracking-wider">Status</p>
              <p className="text-sm text-foreground">{serviceForm.is_active ? 'Active' : 'Inactive'}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="font-mono text-xs"
              onClick={() => onServiceFormChange((prev) => ({ ...prev, is_active: !prev.is_active }))}
            >
              Toggle
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            className="font-mono text-xs"
            onClick={() => onServiceDialogChange(false)}
          >
            Cancel
          </Button>
          <Button
            className="font-mono text-xs"
            disabled={createServiceMutation.isPending || updateServiceMutation.isPending}
            onClick={onSaveService}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ServiceCatalogPage() {
  const [searchParams] = useSearchParams();
  const targetServiceId = searchParams.get('service') || null;
  const [catalogState, setCatalogState] = useRouteTableState('billingServiceCatalog', {
    tab: 'services',
    categorySearch: '',
    serviceSearch: '',
    activeFilter: 'active',
    categoryPage: 1,
    servicePage: 1,
  });
  const {
    tab,
    categorySearch,
    serviceSearch,
    activeFilter,
    categoryPage,
    servicePage,
  } = catalogState;
  const catalogMutationsAvailable = !isRustV2ApiMode();

  useEffect(() => {
    if (!targetServiceId) return;
    if (tab === 'services' && activeFilter === 'all') return;
    setCatalogState({ tab: 'services', activeFilter: 'all' });
  }, [activeFilter, setCatalogState, tab, targetServiceId]);

  // Categories query
  const debouncedCategorySearch = useDebounce(categorySearch, 250);
  const categoriesQuery = useServiceCategories({
    page: categoryPage,
    page_size: 25,
    ...(debouncedCategorySearch ? { search: debouncedCategorySearch } : {}),
  });

  // Services query
  const debouncedServiceSearch = useDebounce(serviceSearch, 250);
  const serviceQueryParams = useMemo(() => {
    if (targetServiceId) {
      return { page: 1, page_size: 1, service_id: targetServiceId };
    }
    return {
      page: servicePage,
      page_size: 25,
      ...(debouncedServiceSearch ? { search: debouncedServiceSearch } : {}),
      ...(activeFilter === 'active' ? { is_active: true } : {}),
    };
  }, [activeFilter, debouncedServiceSearch, servicePage, targetServiceId]);
  const servicesQuery = useServices(serviceQueryParams);

  const createCategoryMutation = useCreateServiceCategory();
  const updateCategoryMutation = useUpdateServiceCategory();
  const createServiceMutation = useCreateService();
  const updateServiceMutation = useUpdateService();

  const categories = normalizeResults(categoriesQuery.data).results;
  const services = normalizeResults(servicesQuery.data).results;

  // Dialog state
  const [categoryDialog, setCategoryDialog] = useState({ open: false, mode: 'create', row: null });
  const [serviceDialog, setServiceDialog] = useState({ open: false, mode: 'create', row: null });

  // Category form
  const [categoryForm, setCategoryForm] = useState({ name: '', description: '', is_active: true });
  // Service form
  const [serviceForm, setServiceForm] = useState({
    name: '',
    code: '',
    category: '',
    description: '',
    base_price: '',
    tax_rate: '0.00',
    is_active: true,
  });

  const isLoading = categoriesQuery.isLoading || servicesQuery.isLoading;
  const error = categoriesQuery.error || servicesQuery.error;

  const handleRefresh = async () => {
    await Promise.allSettled([categoriesQuery.refetch(), servicesQuery.refetch()]);
    toast.success('Refreshed');
  };

  const setTab = (nextTab) => {
    setCatalogState({ tab: nextTab });
  };

  const setCategorySearch = (nextSearch) => {
    setCatalogState({ categorySearch: nextSearch, categoryPage: 1 });
  };

  const setServiceSearch = (nextSearch) => {
    setCatalogState({ serviceSearch: nextSearch, servicePage: 1 });
  };

  const setActiveFilter = (nextFilter) => {
    setCatalogState({ activeFilter: nextFilter, servicePage: 1 });
  };

  const setServicePage = (nextPage) => {
    setCatalogState({ servicePage: nextPage });
  };

  const openNewCategoryDialog = () => {
    setCategoryForm({ name: '', description: '', is_active: true });
    setCategoryDialog({ open: true, mode: 'create', row: null });
  };

  const openEditCategoryDialog = (row) => {
    setCategoryForm({
      name: row.name || '',
      description: row.description || '',
      is_active: !!row.is_active,
    });
    setCategoryDialog({ open: true, mode: 'edit', row });
  };

  const openNewServiceDialog = () => {
    setServiceForm({
      name: '',
      code: '',
      category: '',
      description: '',
      base_price: '',
      tax_rate: '0.00',
      is_active: true,
    });
    setServiceDialog({ open: true, mode: 'create', row: null });
  };

  const openEditServiceDialog = (row) => {
    setServiceForm({
      name: row.name || '',
      code: row.code || '',
      category: row.category || '',
      description: row.description || '',
      base_price: row.base_price?.toString?.() || String(row.base_price ?? ''),
      tax_rate: row.tax_rate?.toString?.() || String(row.tax_rate ?? '0.00'),
      is_active: !!row.is_active,
    });
    setServiceDialog({ open: true, mode: 'edit', row });
  };

  const handleCategoryDialogOpenChange = (open) => {
    setCategoryDialog((prev) => ({ ...prev, open }));
  };

  const handleServiceDialogOpenChange = (open) => {
    setServiceDialog((prev) => ({ ...prev, open }));
  };

  const handleSaveCategory = async () => {
    if (!categoryForm.name.trim()) {
      toast.error('Category name is required');
      return;
    }
    try {
      if (categoryDialog.mode === 'create') {
        await createCategoryMutation.mutateAsync({
          name: categoryForm.name.trim(),
          description: categoryForm.description.trim() || null,
          is_active: categoryForm.is_active,
        });
        toast.success('Category created');
      } else {
        await updateCategoryMutation.mutateAsync({
          id: categoryDialog.row.id,
          data: {
            name: categoryForm.name.trim(),
            description: categoryForm.description.trim() || null,
            is_active: categoryForm.is_active,
          },
        });
        toast.success('Category updated');
      }
      setCategoryDialog({ open: false, mode: 'create', row: null });
    } catch (err) {
      toast.error(err.message || 'Failed to save category');
    }
  };

  const handleSaveService = async () => {
    if (!serviceForm.code.trim()) {
      toast.error('Service code is required');
      return;
    }
    if (!serviceForm.name.trim()) {
      toast.error('Service name is required');
      return;
    }
    if (!serviceForm.category) {
      toast.error('Category is required');
      return;
    }
    const base = Number(serviceForm.base_price);
    if (!Number.isFinite(base) || base < 0) {
      toast.error('Base price must be a valid number');
      return;
    }
    const tax = Number(serviceForm.tax_rate);
    if (!Number.isFinite(tax) || tax < 0) {
      toast.error('Tax rate must be a valid number');
      return;
    }
    try {
      const payload = {
        code: serviceForm.code.trim(),
        name: serviceForm.name.trim(),
        category: serviceForm.category,
        description: serviceForm.description.trim() || null,
        base_price: base.toFixed(2),
        tax_rate: tax.toFixed(2),
        is_active: serviceForm.is_active,
      };
      if (serviceDialog.mode === 'create') {
        await createServiceMutation.mutateAsync(payload);
        toast.success('Service created');
      } else {
        await updateServiceMutation.mutateAsync({ id: serviceDialog.row.id, data: payload });
        toast.success('Service updated');
      }
      setServiceDialog({ open: false, mode: 'create', row: null });
    } catch (err) {
      toast.error(err.message || 'Failed to save service');
    }
  };

  const categoryColumns = useMemo(() => createCategoryColumns({
    catalogMutationsAvailable,
    onEditCategory: openEditCategoryDialog,
  }), [catalogMutationsAvailable]);

  const serviceColumns = useMemo(() => createServiceColumns({
    catalogMutationsAvailable,
    onEditService: openEditServiceDialog,
  }), [catalogMutationsAvailable]);

  if (isLoading && !categoriesQuery.data && !servicesQuery.data) {
    return (
      <PageState variant="loading" />
    );
  }

  if (error) {
    return (
      <PageState
        variant="error"
        title="Error Loading Catalog"
        description={error.message}
        action={() => handleRefresh()}
      />
    );
  }

  return (
    <PageShell>
      <ServiceCatalogHeader
        catalogMutationsAvailable={catalogMutationsAvailable}
        onNewCategory={openNewCategoryDialog}
        onNewService={openNewServiceDialog}
        onRefresh={handleRefresh}
        tab={tab}
      />

      <main className="p-4 sm:p-6 space-y-4">
        {!catalogMutationsAvailable ? <ServiceCatalogReadOnlyNotice /> : null}

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="services" className="font-mono text-xs">Services</TabsTrigger>
            <TabsTrigger value="categories" className="font-mono text-xs">Categories</TabsTrigger>
          </TabsList>

          <ServicesTab
            activeFilter={activeFilter}
            serviceColumns={serviceColumns}
            serviceData={servicesQuery.data}
            serviceSearch={serviceSearch}
            services={services}
            targetServiceId={targetServiceId}
            setServicePage={setServicePage}
            setActiveFilter={setActiveFilter}
            setServiceSearch={setServiceSearch}
          />

          <CategoriesTab
            categories={categories}
            categoryColumns={categoryColumns}
            categorySearch={categorySearch}
            setCategorySearch={setCategorySearch}
          />
        </Tabs>
      </main>

      <CategoryDialog
        categoryDialog={categoryDialog}
        categoryForm={categoryForm}
        createCategoryMutation={createCategoryMutation}
        onCategoryDialogChange={handleCategoryDialogOpenChange}
        onCategoryFormChange={setCategoryForm}
        onSaveCategory={handleSaveCategory}
        updateCategoryMutation={updateCategoryMutation}
      />

      <ServiceDialog
        categories={categories}
        createServiceMutation={createServiceMutation}
        onSaveService={handleSaveService}
        onServiceDialogChange={handleServiceDialogOpenChange}
        onServiceFormChange={setServiceForm}
        serviceDialog={serviceDialog}
        serviceForm={serviceForm}
        updateServiceMutation={updateServiceMutation}
      />
    </PageShell>
  );
}

function formatCurrency(amount) {
  const n = typeof amount === 'string' ? parseFloat(amount) : amount;
  return GHS_CURRENCY_FORMATTER.format(Number.isFinite(n) ? n : 0);
}
