import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  useInventoryCategories,
  useSuppliers,
  useCreateInventoryItem,
  useUpdateInventoryItem,
} from '@/hooks/useInventoryQueries';
import { toast } from 'sonner';
import Package from 'lucide-react/dist/esm/icons/package.js';
import DollarSign from 'lucide-react/dist/esm/icons/dollar-sign.js';
import Building2 from 'lucide-react/dist/esm/icons/building-2.js';
import Settings from 'lucide-react/dist/esm/icons/settings.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2.js';
import Save from 'lucide-react/dist/esm/icons/save.js';
import X from 'lucide-react/dist/esm/icons/x.js';

const UNIT_OF_MEASURE_OPTIONS = [
  { value: 'unit', label: 'Unit' },
  { value: 'tablet', label: 'Tablet' },
  { value: 'capsule', label: 'Capsule' },
  { value: 'bottle', label: 'Bottle' },
  { value: 'vial', label: 'Vial' },
  { value: 'ampoule', label: 'Ampoule' },
  { value: 'box', label: 'Box' },
  { value: 'pack', label: 'Pack' },
  { value: 'carton', label: 'Carton' },
  { value: 'ml', label: 'Milliliter (ml)' },
  { value: 'mg', label: 'Milligram (mg)' },
  { value: 'g', label: 'Gram (g)' },
  { value: 'kg', label: 'Kilogram (kg)' },
  { value: 'l', label: 'Liter (L)' },
  { value: 'each', label: 'Each' },
  { value: 'pair', label: 'Pair' },
  { value: 'set', label: 'Set' },
  { value: 'roll', label: 'Roll' },
  { value: 'sheet', label: 'Sheet' },
];

const formSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  sku: z.string().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  supplier: z.string().optional(),
  unit_of_measure: z.string().min(1, 'Unit of measure is required'),
  unit_price: z.coerce.number().min(0, 'Price must be a positive number'),
  reorder_level: z.coerce.number().min(0, 'Reorder level must be a positive number'),
  reorder_quantity: z.coerce.number().min(1, 'Reorder quantity must be at least 1'),
  max_stock_level: z.coerce.number().min(0, 'Max stock must be a positive number').optional(),
  lead_time_days: z.coerce.number().min(0, 'Lead time must be a positive number').optional(),
  is_controlled: z.boolean().default(false),
  is_active: z.boolean().default(true),
  requires_prescription: z.boolean().default(false),
  track_expiry: z.boolean().default(true),
});

/**
 * InventoryItemForm - Create/edit form for inventory items
 */
export function InventoryItemForm({
  item,
  onSuccess,
  onCancel,
  className,
}) {
  const isEditing = Boolean(item?.id);

  const { data: categoriesData, isLoading: categoriesLoading } = useInventoryCategories();
  const { data: suppliersData, isLoading: suppliersLoading } = useSuppliers();

  const categories = categoriesData?.results || categoriesData || [];
  const suppliers = suppliersData?.results || suppliersData || [];

  const createMutation = useCreateInventoryItem();
  const updateMutation = useUpdateInventoryItem();

  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: item?.name || '',
      sku: item?.sku || '',
      description: item?.description || '',
      category: item?.category?.toString() || item?.category_id?.toString() || '',
      supplier: item?.supplier?.toString() || item?.supplier_id?.toString() || '',
      unit_of_measure: item?.unit_of_measure || item?.unit || 'unit',
      unit_price: item?.unit_price || 0,
      reorder_level: item?.reorder_level || 10,
      reorder_quantity: item?.reorder_quantity || 50,
      max_stock_level: item?.max_stock_level || 500,
      lead_time_days: item?.lead_time_days || 7,
      is_controlled: item?.is_controlled || false,
      is_active: item?.is_active !== false,
      requires_prescription: item?.requires_prescription || false,
      track_expiry: item?.track_expiry !== false,
    },
  });

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  const onSubmit = async (data) => {
    try {
      // Clean up data
      const payload = {
        ...data,
        category: data.category || null,
        supplier: data.supplier || null,
        max_stock_level: data.max_stock_level || null,
        lead_time_days: data.lead_time_days || null,
      };

      if (isEditing) {
        await updateMutation.mutateAsync({ id: item.id, data: payload });
        toast.success('Item updated successfully');
      } else {
        await createMutation.mutateAsync(payload);
        toast.success('Item created successfully');
      }

      onSuccess?.();
    } catch (error) {
      toast.error(error.message || `Failed to ${isEditing ? 'update' : 'create'} item`);
    }
  };

  if (categoriesLoading || suppliersLoading) {
    return (
      <div className={cn('space-y-6', className)}>
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} className="bg-card/30 border-border/50">
            <CardHeader className="pb-3">
              <Skeleton className="h-5 w-32" />
            </CardHeader>
            <CardContent className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className={cn('space-y-6', className)}>
        {/* Basic Information */}
        <Card className="bg-card/30 border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Package className="h-5 w-5 text-sky-500" />
              Basic Information
            </CardTitle>
            <CardDescription>
              General details about the inventory item
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name *</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., Paracetamol 500mg Tablets" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
              <FormField
                control={form.control}
                name="sku"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>SKU</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., MED-001" className="font-mono" {...field} />
                    </FormControl>
                    <FormDescription>
                      Stock Keeping Unit identifier
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="category"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Category</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select category" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {categories.map((cat) => (
                          <SelectItem key={cat.id} value={cat.id.toString()}>
                            {cat.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Group for organizing items
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="unit_of_measure"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Unit of Measure *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select unit" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {UNIT_OF_MEASURE_OPTIONS.map((unit) => (
                        <SelectItem key={unit.value} value={unit.value}>
                          {unit.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Enter item description..."
                      className="resize-none"
                      rows={3}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* Pricing & Stock */}
        <Card className="bg-card/30 border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <DollarSign className="h-5 w-5 text-emerald-500" />
              Pricing & Stock Levels
            </CardTitle>
            <CardDescription>
              Set pricing and reorder parameters
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
              <FormField
                control={form.control}
                name="unit_price"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Unit Price *</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                          $
                        </span>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          className="pl-7 font-mono"
                          {...field}
                        />
                      </div>
                    </FormControl>
                    <FormDescription>
                      Cost per unit of measure
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="reorder_level"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reorder Level *</FormLabel>
                    <FormControl>
                      <Input type="number" min="0" className="font-mono" {...field} />
                    </FormControl>
                    <FormDescription>
                      Alert when stock falls below
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="reorder_quantity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reorder Quantity *</FormLabel>
                    <FormControl>
                      <Input type="number" min="1" className="font-mono" {...field} />
                    </FormControl>
                    <FormDescription>
                      Default quantity to order
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="max_stock_level"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Max Stock Level</FormLabel>
                    <FormControl>
                      <Input type="number" min="0" className="font-mono" {...field} />
                    </FormControl>
                    <FormDescription>
                      Maximum stock to maintain
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </CardContent>
        </Card>

        {/* Supplier */}
        <Card className="bg-card/30 border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="h-5 w-5 text-amber-500" />
              Supplier
            </CardTitle>
            <CardDescription>
              Associate with a supplier for procurement
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
              <FormField
                control={form.control}
                name="supplier"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Primary Supplier</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select supplier" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {suppliers.map((sup) => (
                          <SelectItem key={sup.id} value={sup.id.toString()}>
                            {sup.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Vendor for procurement
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="lead_time_days"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Lead Time (Days)</FormLabel>
                    <FormControl>
                      <Input type="number" min="0" className="font-mono" {...field} />
                    </FormControl>
                    <FormDescription>
                      Expected delivery time
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </CardContent>
        </Card>

        {/* Settings */}
        <Card className="bg-card/30 border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Settings className="h-5 w-5 text-muted-foreground" />
              Settings
            </CardTitle>
            <CardDescription>
              Additional item configuration
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <FormField
              control={form.control}
              name="is_active"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border border-border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">Active</FormLabel>
                    <FormDescription>
                      Item is available for use in the system
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="is_controlled"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border border-rose-500/30 p-4 bg-rose-500/5">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">Controlled Substance</FormLabel>
                    <FormDescription>
                      Requires special tracking and witness verification
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="requires_prescription"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border border-border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">Requires Prescription</FormLabel>
                    <FormDescription>
                      Can only be dispensed with valid prescription
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="track_expiry"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border border-border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">Track Expiry</FormLabel>
                    <FormDescription>
                      Monitor batch expiry dates for FEFO management
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            {isEditing ? 'Update Item' : 'Create Item'}
          </Button>
        </div>
      </form>
    </Form>
  );
}

export default InventoryItemForm;
