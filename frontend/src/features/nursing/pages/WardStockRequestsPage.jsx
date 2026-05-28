import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { cn, normalizeApiResults } from '@/lib/utils';
import { useDebounce } from '@/hooks/use-debounce';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { InternalRequisitionDetailDialog } from '@/components/inventory/InternalRequisitionDetailDialog';
import {
  useCreateInternalRequisition,
  useInternalRequisitions,
  useInventoryItems,
  useStorageLocations,
  useSubmitInternalRequisition,
} from '@/features/inventory/hooks';
import { PageHeader } from '@/shared/components/page/PageHeader';
import { PageShell } from '@/shared/components/page/PageShell';
import { PageState } from '@/shared/components/page/PageState';
import { usePageMeta } from '@/shared/hooks/usePageMeta';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import MapPin from 'lucide-react/dist/esm/icons/map-pin.js';
import Package from 'lucide-react/dist/esm/icons/package.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.js';
import Search from 'lucide-react/dist/esm/icons/search.js';
import Send from 'lucide-react/dist/esm/icons/send.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';

const PAGE_SIZE = 20;

const STATUS_TABS = [
  { value: 'all', label: 'All' },
  { value: 'pending_approval', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'fulfilled', label: 'Fulfilled' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'cancelled', label: 'Cancelled' },
];

const STATUS_CONFIG = {
  draft: { label: 'Draft', className: 'bg-muted text-muted-foreground border-border' },
  pending_approval: { label: 'Pending Approval', className: 'bg-amber-500/10 text-amber-600 border-amber-500/30' },
  approved: { label: 'Approved', className: 'bg-sky-500/10 text-sky-600 border-sky-500/30' },
  in_progress: { label: 'In Progress', className: 'bg-indigo-500/10 text-indigo-600 border-indigo-500/30' },
  fulfilled: { label: 'Fulfilled', className: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' },
  partially_fulfilled: { label: 'Partially Fulfilled', className: 'bg-teal-500/10 text-teal-600 border-teal-500/30' },
  rejected: { label: 'Rejected', className: 'bg-rose-500/10 text-rose-600 border-rose-500/30' },
  cancelled: { label: 'Cancelled', className: 'bg-muted text-muted-foreground border-border' },
};

const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

const FULFILLING_LOCATION_TYPES = new Set(['warehouse', 'pharmacy', 'satellite', 'department_store']);

const requestFormSchema = z.object({
  requesting_location: z.string().min(1, 'Ward store is required'),
  fulfilling_location: z.string().min(1, 'Fulfilling store is required'),
  date_required: z.string().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  justification: z.string().trim().min(2, 'Reason is required'),
  notes: z.string().optional(),
  items: z.array(z.object({
    item: z.string().min(1, 'Item is required'),
    quantity_requested: z.coerce.number().int().min(1, 'Quantity must be at least 1'),
    notes: z.string().optional(),
  })).min(1, 'At least one item is required'),
}).refine((data) => data.requesting_location !== data.fulfilling_location, {
  message: 'Fulfilling store must differ from ward store',
  path: ['fulfilling_location'],
});

function statusConfig(status) {
  return STATUS_CONFIG[status] || STATUS_CONFIG.draft;
}

function formatDate(value) {
  if (!value) return 'No required date';
  try {
    return format(parseISO(value), 'MMM d, yyyy');
  } catch {
    return value;
  }
}

function WardStockLocationFields({ control, locationsLoading, wardStores, fulfillingLocations }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <FormField
        control={control}
        name="requesting_location"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Ward Store</FormLabel>
            <Select onValueChange={field.onChange} value={field.value} disabled={locationsLoading}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder={locationsLoading ? 'Loading stores...' : 'Select ward store'} />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {wardStores.map((location) => (
                  <SelectItem key={location.id} value={location.id}>
                    {location.name} ({location.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormDescription>Only ward stores can create ward stock requests.</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={control}
        name="fulfilling_location"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Fulfilling Store</FormLabel>
            <Select onValueChange={field.onChange} value={field.value} disabled={locationsLoading}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder={locationsLoading ? 'Loading stores...' : 'Select source store'} />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {fulfillingLocations.map((location) => (
                  <SelectItem key={location.id} value={location.id}>
                    {location.name} ({location.code})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}

function WardStockRequestDetailsFields({ control }) {
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <FormField
          control={control}
          name="priority"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Priority</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {PRIORITIES.map((priority) => (
                    <SelectItem key={priority.value} value={priority.value}>
                      {priority.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name="date_required"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Required By</FormLabel>
              <FormControl>
                <Input type="date" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <FormField
        control={control}
        name="justification"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Reason</FormLabel>
            <FormControl>
              <Textarea placeholder="Ward stock replenishment, emergency top-up, routine stock issue..." {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}

function WardStockItemsFieldArray({ control, fields, inventoryItems, itemsLoading, onAppend, onRemove }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <FormLabel>Items</FormLabel>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onAppend}
        >
          <Plus className="mr-2 size-4" />
          Add Item
        </Button>
      </div>

      {fields.map((field, index) => (
        <div key={field.id} className="grid gap-3 rounded-lg border bg-card/40 p-3 md:grid-cols-[1fr_120px_1fr_auto]">
          <FormField
            control={control}
            name={`items.${index}.item`}
            render={({ field }) => (
              <FormItem>
                <Select onValueChange={field.onChange} value={field.value} disabled={itemsLoading}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder={itemsLoading ? 'Loading items...' : 'Select item'} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {inventoryItems.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name} ({item.sku})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={control}
            name={`items.${index}.quantity_requested`}
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <Input type="number" min="1" placeholder="Qty" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={control}
            name={`items.${index}.notes`}
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <Input placeholder="Notes (optional)" {...field} />
                </FormControl>
              </FormItem>
            )}
          />

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-destructive"
            onClick={() => onRemove(index)}
            disabled={fields.length === 1}
            aria-label="Remove item"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}

function WardStockNotesField({ control }) {
  return (
    <FormField
      control={control}
      name="notes"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Notes</FormLabel>
          <FormControl>
            <Textarea placeholder="Optional handling notes for inventory staff." {...field} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function WardStockRequestFormFooter({ isSubmitting, onCancel }) {
  return (
    <DialogFooter>
      <Button type="button" variant="outline" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? (
          <LoadingSpinner className="mr-2 size-4" />
        ) : (
          <Send className="mr-2 size-4" />
        )}
        Submit Request
      </Button>
    </DialogFooter>
  );
}

function WardStockRequestForm({ open, onOpenChange }) {
  const { data: locationsData, isLoading: locationsLoading } = useStorageLocations({
    page_size: 200,
    is_active: true,
  });
  const { data: itemsData, isLoading: itemsLoading } = useInventoryItems({
    page_size: 200,
    ordering: 'name',
  });

  const createMutation = useCreateInternalRequisition();
  const submitMutation = useSubmitInternalRequisition();

  const locations = normalizeApiResults(locationsData);
  const inventoryItems = normalizeApiResults(itemsData);
  const wardStores = useMemo(
    () => locations.filter((location) => location.location_type === 'ward_store' && location.is_active),
    [locations]
  );

  const form = useForm({
    resolver: zodResolver(requestFormSchema),
    defaultValues: {
      requesting_location: '',
      fulfilling_location: '',
      date_required: '',
      priority: 'normal',
      justification: '',
      notes: '',
      items: [{ item: '', quantity_requested: 1, notes: '' }],
    },
  });

  const requestingLocation = form.watch('requesting_location');
  const fulfillingLocations = useMemo(
    () => locations.filter((location) => (
      location.is_active
      && location.id !== requestingLocation
      && FULFILLING_LOCATION_TYPES.has(location.location_type)
    )),
    [locations, requestingLocation]
  );

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'items',
  });

  const isSubmitting = createMutation.isPending || submitMutation.isPending;

  const handleSubmit = async (values) => {
    try {
      const created = await createMutation.mutateAsync({
        requesting_location: values.requesting_location,
        fulfilling_location: values.fulfilling_location,
        date_required: values.date_required || null,
        priority: values.priority,
        justification: values.justification.trim(),
        notes: values.notes || '',
        items: values.items.map((item) => ({
          item: item.item,
          quantity_requested: item.quantity_requested,
          notes: item.notes || '',
        })),
      });

      await submitMutation.mutateAsync(created.id);
      toast.success('Ward stock request submitted');
      form.reset();
      onOpenChange(false);
    } catch (error) {
      toast.error(error.message || 'Failed to submit ward stock request');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[86vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">Request Ward Stock</DialogTitle>
          <DialogDescription>
            Create an internal inventory request from a ward store to the main store or pharmacy.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-5">
            <WardStockLocationFields
              control={form.control}
              locationsLoading={locationsLoading}
              wardStores={wardStores}
              fulfillingLocations={fulfillingLocations}
            />

            <WardStockRequestDetailsFields control={form.control} />

            <WardStockItemsFieldArray
              control={form.control}
              fields={fields}
              inventoryItems={inventoryItems}
              itemsLoading={itemsLoading}
              onAppend={() => append({ item: '', quantity_requested: 1, notes: '' })}
              onRemove={remove}
            />

            <WardStockNotesField control={form.control} />

            <WardStockRequestFormFooter
              isSubmitting={isSubmitting}
              onCancel={() => onOpenChange(false)}
            />
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

export default function WardStockRequestsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedRequestId, setSelectedRequestId] = useState(null);

  const status = searchParams.get('status') || 'all';
  const page = Number.parseInt(searchParams.get('page') || '1', 10);
  const debouncedSearch = useDebounce(search, 300);

  const queryParams = {
    page,
    page_size: PAGE_SIZE,
    ...(status !== 'all' && { status }),
    ...(debouncedSearch && { search: debouncedSearch }),
  };

  const { data, isLoading, error, refetch, isFetching } = useInternalRequisitions(queryParams);
  const requests = normalizeApiResults(data);
  const totalCount = data?.count || requests.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const pageMeta = usePageMeta({
    title: 'Ward Stock Requests | HMS',
    breadcrumbs: [
      { label: 'Nursing', href: '/nursing/dashboard' },
      { label: 'Ward Stock Requests', href: '/nursing/ward-stock-requests' },
    ],
  });

  const updateParams = (updates) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      Object.entries(updates).forEach(([key, value]) => {
        if (!value || value === 'all') params.delete(key);
        else params.set(key, value);
      });
      return params;
    });
  };

  const handleSearchChange = (event) => {
    const value = event.target.value;
    setSearch(value);
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (value) params.set('search', value);
      else params.delete('search');
      params.set('page', '1');
      return params;
    });
  };

  const handleStatusChange = (value) => {
    updateParams({ status: value, page: '1' });
  };

  const handlePageChange = (nextPage) => {
    updateParams({ page: String(nextPage) });
  };

  if (isLoading) {
    return (
      <PageState variant="loading" fullHeight={false} className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-10 w-full max-w-xl" />
        <div className="grid gap-3">
          {[...Array(4)].map((_, index) => (
            <Skeleton key={index} className="h-28 w-full" />
          ))}
        </div>
      </PageState>
    );
  }

  if (error) {
    return (
      <PageState
        variant="error"
        title="Unable to Load Ward Stock Requests"
        description={error.message}
        action={() => refetch()}
      />
    );
  }

  return (
    <PageShell>
      {pageMeta}
      <PageHeader
        title="Ward Stock Requests"
        description={`${totalCount} inventory request${totalCount === 1 ? '' : 's'} for ward stock`}
        actions={(
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => refetch()}>
              {isFetching ? (
                <LoadingSpinner className="mr-2 h-4 w-8" />
              ) : (
                <RefreshCw className="mr-2 size-4" />
              )}
              Refresh
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 size-4" />
              Request Stock
            </Button>
          </div>
        )}
      />

      <div className="space-y-5 p-4 sm:p-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <Tabs value={status} onValueChange={handleStatusChange}>
            <TabsList className="w-full sm:w-auto">
              {STATUS_TABS.map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value} className="font-mono text-xs">
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          <div className="relative w-full lg:w-[360px]">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={handleSearchChange}
              placeholder="Search request number or reason"
              className="pl-9"
            />
          </div>
        </div>

        {requests.length > 0 ? (
          <div className="grid gap-3">
            {requests.map((request) => {
              const currentStatus = statusConfig(request.status);
              return (
                <Card
                  key={request.id}
                  className="cursor-pointer bg-card/40 transition-colors hover:bg-card/70"
                  onClick={() => setSelectedRequestId(request.id)}
                >
                  <CardContent className="p-4">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <ClipboardList className="size-4 text-muted-foreground" />
                          <span className="font-mono text-sm font-medium text-primary">
                            {request.requisition_number}
                          </span>
                          <Badge variant="outline" className={cn('text-xs', currentStatus.className)}>
                            {currentStatus.label}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="size-4" />
                            {request.requesting_location_name}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Package className="size-4" />
                            {request.items_count || 0} item{(request.items_count || 0) === 1 ? '' : 's'}
                          </span>
                          <span className="font-mono">{formatDate(request.date_required)}</span>
                        </div>
                      </div>

                      <Button variant="outline" size="sm" onClick={(event) => {
                        event.stopPropagation();
                        setSelectedRequestId(request.id);
                      }}>
                        View Details
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <div className="rounded-lg border bg-card/40 p-10 text-center">
            <Package className="mx-auto mb-3 size-10 text-muted-foreground/60" />
            <h2 className="font-display text-xl">No Ward Stock Requests</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Requests submitted here go to inventory or pharmacy for approval and issue.
            </p>
            <Button className="mt-4" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 size-4" />
              Request Stock
            </Button>
          </div>
        )}

        {totalPages > 1 ? (
          <div className="flex items-center justify-between border-t pt-4">
            <p className="font-mono text-xs text-muted-foreground">
              Page {page} of {totalPages}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => handlePageChange(page - 1)} disabled={page <= 1}>
                <ChevronLeft className="mr-1 size-4" />
                Previous
              </Button>
              <Button variant="outline" size="sm" onClick={() => handlePageChange(page + 1)} disabled={page >= totalPages}>
                Next
                <ChevronRight className="ml-1 size-4" />
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <WardStockRequestForm open={createOpen} onOpenChange={setCreateOpen} />
      <InternalRequisitionDetailDialog
        requisitionId={selectedRequestId}
        open={!!selectedRequestId}
        onOpenChange={(open) => {
          if (!open) setSelectedRequestId(null);
        }}
        mode="requester"
      />
    </PageShell>
  );
}
