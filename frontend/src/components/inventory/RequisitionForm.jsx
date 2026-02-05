import { useState } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
  useInventoryItems,
  useSuppliers,
  useCreateRequisition,
} from '@/features/inventory/hooks';
import { toast } from 'sonner';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2.js';
import Save from 'lucide-react/dist/esm/icons/save.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
];

const formSchema = z.object({
  title: z.string().min(2, 'Title is required'),
  supplier: z.string().optional(),
  priority: z.string().default('normal'),
  notes: z.string().optional(),
  required_date: z.string().optional(),
  items: z.array(z.object({
    item: z.string().min(1, 'Item is required'),
    quantity: z.coerce.number().min(1, 'Quantity must be at least 1'),
    notes: z.string().optional(),
  })).min(1, 'At least one item is required'),
});

/**
 * RequisitionForm - Create purchase requisition
 */
export function RequisitionForm({ onSuccess, onCancel, initialItems = [] }) {
  const { data: itemsData } = useInventoryItems({ page_size: 200 });
  const { data: suppliersData } = useSuppliers({ page_size: 100 });

  const items = itemsData?.results || [];
  const suppliers = suppliersData?.results || suppliersData || [];

  const createMutation = useCreateRequisition();

  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      title: '',
      supplier: '',
      priority: 'normal',
      notes: '',
      required_date: '',
      items: initialItems.length > 0
        ? initialItems.map((id) => ({ item: id, quantity: 1, notes: '' }))
        : [{ item: '', quantity: 1, notes: '' }],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'items',
  });

  const isSubmitting = createMutation.isPending;

  const onSubmit = async (data) => {
    try {
      const payload = {
        ...data,
        supplier: data.supplier && data.supplier !== 'none' ? data.supplier : null,
        items: data.items.map((item) => ({
          item_id: item.item,
          quantity: item.quantity,
          notes: item.notes || '',
        })),
      };

      await createMutation.mutateAsync(payload);
      toast.success('Requisition created successfully');
      onSuccess?.();
    } catch (error) {
      toast.error(error.message || 'Failed to create requisition');
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Title *</FormLabel>
              <FormControl>
                <Input placeholder="Monthly pharmacy stock replenishment" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          <FormField
            control={form.control}
            name="supplier"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Preferred Supplier</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select supplier (optional)" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="none">Any Supplier</SelectItem>
                    {suppliers.map((sup) => (
                      <SelectItem key={sup.id} value={sup.id.toString()}>
                        {sup.name}
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
            name="priority"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Priority</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {PRIORITY_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="required_date"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Required By</FormLabel>
              <FormControl>
                <Input type="date" {...field} />
              </FormControl>
              <FormDescription>When do you need these items?</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Items */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <FormLabel>Items *</FormLabel>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => append({ item: '', quantity: 1, notes: '' })}
            >
              <Plus className="h-4 w-4 mr-1" />
              Add Item
            </Button>
          </div>

          {fields.map((field, index) => (
            <div key={field.id} className="flex gap-3 items-start p-3 border rounded-lg">
              <div className="flex-1 space-y-3">
                <FormField
                  control={form.control}
                  name={`items.${index}.item`}
                  render={({ field }) => (
                    <FormItem>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select item" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {items.map((item) => (
                            <SelectItem key={item.id} value={item.id.toString()}>
                              {item.name} ({item.sku})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex gap-3">
                  <FormField
                    control={form.control}
                    name={`items.${index}.quantity`}
                    render={({ field }) => (
                      <FormItem className="w-32">
                        <FormControl>
                          <Input type="number" min="1" placeholder="Qty" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name={`items.${index}.notes`}
                    render={({ field }) => (
                      <FormItem className="flex-1">
                        <FormControl>
                          <Input placeholder="Notes (optional)" {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
              </div>

              {fields.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-destructive"
                  onClick={() => remove(index)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
        </div>

        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Notes</FormLabel>
              <FormControl>
                <Textarea placeholder="Any additional notes..." {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting} className="min-w-[140px]">
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Create
          </Button>
        </div>
      </form>
    </Form>
  );
}

export default RequisitionForm;
