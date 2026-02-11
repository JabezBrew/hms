import Layers from 'lucide-react/dist/esm/icons/layers.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import Search from 'lucide-react/dist/esm/icons/search.js';
import Pencil from 'lucide-react/dist/esm/icons/square-pen.js';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { useDebounce } from '@/hooks/use-debounce';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageState } from '@/shared/components/page/PageState';
import { VirtualizedTable } from '@/components/ui/VirtualizedTable';
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

function normalizeResults(data) {
  if (!data) return { results: [], count: 0 };
  if (Array.isArray(data)) return { results: data, count: data.length };
  return { results: data.results || [], count: data.count || (data.results ? data.results.length : 0) };
}

export default function ServiceCatalogPage() {
  const [tab, setTab] = useState('services');

  // Categories query
  const [categorySearch, setCategorySearch] = useState('');
  const debouncedCategorySearch = useDebounce(categorySearch, 250);
  const categoriesQuery = useServiceCategories({
    page: 1,
    page_size: 200,
    ...(debouncedCategorySearch ? { search: debouncedCategorySearch } : {}),
  });

  // Services query
  const [serviceSearch, setServiceSearch] = useState('');
  const debouncedServiceSearch = useDebounce(serviceSearch, 250);
  const [activeFilter, setActiveFilter] = useState('active');
  const servicesQuery = useServices({
    page: 1,
    page_size: 200,
    ...(debouncedServiceSearch ? { search: debouncedServiceSearch } : {}),
    ...(activeFilter === 'active' ? { is_active: true } : {}),
  });

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

  const categoryColumns = useMemo(() => ([
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
      render: (row) => (
        <span className={cn(
          'font-mono text-xs px-2 py-1 rounded',
          row.is_active ? 'badge-chronicle-emerald' : 'bg-muted text-muted-foreground'
        )}>
          {row.is_active ? 'Active' : 'Inactive'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '140px',
      headerClassName: 'text-right',
      cellClassName: 'text-right',
      render: (row) => (
        <Button
          variant="outline"
          size="sm"
          className="font-mono text-xs"
          onClick={() => {
            setCategoryForm({
              name: row.name || '',
              description: row.description || '',
              is_active: !!row.is_active,
            });
            setCategoryDialog({ open: true, mode: 'edit', row });
          }}
        >
          <Pencil className="h-3 w-3 mr-2" />
          Edit
        </Button>
      ),
    },
  ]), []);

  const serviceColumns = useMemo(() => ([
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
      render: (row) => (
        <span className={cn(
          'font-mono text-xs px-2 py-1 rounded',
          row.is_active ? 'badge-chronicle-emerald' : 'bg-muted text-muted-foreground'
        )}>
          {row.is_active ? 'Active' : 'Inactive'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      width: '140px',
      headerClassName: 'text-right',
      cellClassName: 'text-right',
      render: (row) => (
        <Button
          variant="outline"
          size="sm"
          className="font-mono text-xs"
          onClick={() => {
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
          }}
        >
          <Pencil className="h-3 w-3 mr-2" />
          Edit
        </Button>
      ),
    },
  ]), []);

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
      <PageHeader
        title={(
          <span className="flex items-center gap-3">
            <span className="p-3 rounded-xl bg-primary/10">
              <Layers className="h-6 w-6 text-primary" />
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
              onClick={handleRefresh}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
            {tab === 'categories' ? (
              <Button
                size="sm"
                className="font-mono text-xs"
                onClick={() => {
                  setCategoryForm({ name: '', description: '', is_active: true });
                  setCategoryDialog({ open: true, mode: 'create', row: null });
                }}
              >
                <Plus className="h-4 w-4 mr-2" />
                New Category
              </Button>
            ) : (
              <Button
                size="sm"
                className="font-mono text-xs"
                onClick={() => {
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
                }}
              >
                <Plus className="h-4 w-4 mr-2" />
                New Service
              </Button>
            )}
          </div>
        )}
      />

      <main className="p-4 sm:p-6 space-y-4">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="services" className="font-mono text-xs">Services</TabsTrigger>
            <TabsTrigger value="categories" className="font-mono text-xs">Categories</TabsTrigger>
          </TabsList>

          <TabsContent value="services" className="mt-4 space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1 max-w-xl">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={serviceSearch}
                  onChange={(e) => setServiceSearch(e.target.value)}
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
              rows={services}
              threshold={50}
              className="rounded-2xl border border-border bg-card"
            />
          </TabsContent>

          <TabsContent value="categories" className="mt-4 space-y-3">
            <div className="relative flex-1 max-w-xl">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={categorySearch}
                onChange={(e) => setCategorySearch(e.target.value)}
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
        </Tabs>
      </main>

      {/* Category Dialog */}
      <Dialog open={categoryDialog.open} onOpenChange={(open) => setCategoryDialog((prev) => ({ ...prev, open }))}>
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
                onChange={(e) => setCategoryForm((p) => ({ ...p, name: e.target.value }))}
                className="font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase tracking-wider">Description</Label>
              <Input
                value={categoryForm.description}
                onChange={(e) => setCategoryForm((p) => ({ ...p, description: e.target.value }))}
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
                onClick={() => setCategoryForm((p) => ({ ...p, is_active: !p.is_active }))}
              >
                Toggle
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              className="font-mono text-xs"
              onClick={() => setCategoryDialog({ open: false, mode: 'create', row: null })}
            >
              Cancel
            </Button>
            <Button
              className="font-mono text-xs"
              disabled={createCategoryMutation.isPending || updateCategoryMutation.isPending}
              onClick={async () => {
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
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Service Dialog */}
      <Dialog open={serviceDialog.open} onOpenChange={(open) => setServiceDialog((prev) => ({ ...prev, open }))}>
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
                  onChange={(e) => setServiceForm((p) => ({ ...p, code: e.target.value }))}
                  className="font-mono"
                  placeholder="e.g. LAB-FBC"
                />
              </div>
              <div className="space-y-2">
                <Label className="font-mono text-xs uppercase tracking-wider">Category</Label>
                <Select
                  value={serviceForm.category}
                  onValueChange={(val) => setServiceForm((p) => ({ ...p, category: val }))}
                >
                  <SelectTrigger className="font-mono text-sm">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories
                      .filter((c) => c.is_active)
                      .map((c) => (
                        <SelectItem key={c.id} value={c.id} className="font-mono text-sm">
                          {c.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase tracking-wider">Name</Label>
              <Input
                value={serviceForm.name}
                onChange={(e) => setServiceForm((p) => ({ ...p, name: e.target.value }))}
                className="font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label className="font-mono text-xs uppercase tracking-wider">Description</Label>
              <Input
                value={serviceForm.description}
                onChange={(e) => setServiceForm((p) => ({ ...p, description: e.target.value }))}
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
                  onChange={(e) => setServiceForm((p) => ({ ...p, base_price: e.target.value }))}
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
                  onChange={(e) => setServiceForm((p) => ({ ...p, tax_rate: e.target.value }))}
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
                onClick={() => setServiceForm((p) => ({ ...p, is_active: !p.is_active }))}
              >
                Toggle
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              className="font-mono text-xs"
              onClick={() => setServiceDialog({ open: false, mode: 'create', row: null })}
            >
              Cancel
            </Button>
            <Button
              className="font-mono text-xs"
              disabled={createServiceMutation.isPending || updateServiceMutation.isPending}
              onClick={async () => {
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
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

function formatCurrency(amount) {
  const n = typeof amount === 'string' ? parseFloat(amount) : amount;
  return new Intl.NumberFormat('en-GH', {
    style: 'currency',
    currency: 'GHS',
    minimumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
}
