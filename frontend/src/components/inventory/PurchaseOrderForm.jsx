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
  useSuppliers,
  useInventoryItems,
  useRequisitions,
  useCreatePurchaseOrder,
} from '@/features/inventory/hooks';
import { toast } from 'sonner';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2.js';
import Save from 'lucide-react/dist/esm/icons/save.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';

const formSchema = z.object({
  supplier: z.string().min(1, 'Supplier is required'),
  requisition: z.string().optional(),
  expected_delivery_date: z.string().optional(),
  shipping_address: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(z.object({
    item: z.string().min(1, 'Item is required'),
    quantity: z.coerce.number().min(1, 'Quantity must be at least 1'),
    unit_price: z.coerce.number().min(0, 'Price must be positive'),
  })).min(1, 'At least one item is required'),
});

/**
 * PurchaseOrderForm - Create purchase order
 */
export function PurchaseOrderForm({ onSuccess, onCancel, initialRequisitionId }) {
  const { data: suppliersData } = useSuppliers({ page_size: 100 });
  const { data: itemsData } = useInventoryItems({ page_size: 200 });
  const { data: requisitionsData } = useRequisitions({ status: 'approved', page_size: 50 });

  const suppliers = suppliersData?.results || suppliersData || [];
  const items = itemsData?.results || [];
  const requisitions = requisitionsData?.results || [];

  const createMutation = useCreatePurchaseOrder();

  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      supplier: '',
      requisition: initialRequisitionId || '',
      expected_delivery_date: '',
      shipping_address: '',
      notes: '',
      items: [{ item: '', quantity: 1, unit_price: 0 }],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'items',
  });

  const isSubmitting = createMutation.isPending;

  const onSubmit = async (data) => {
    try {
      const selectedSupplier = suppliers.find((supplier) => (
        String(supplier.id) === String(data.supplier)
      ));
      const payload = {
        supplier: selectedSupplier ? {
          id: selectedSupplier.id,
          name: selectedSupplier.name,
        } : data.supplier,
        supplier_name: selectedSupplier?.name || data.supplier,
        requisition: data.requisition && data.requisition !== 'none' ? data.requisition : null,
        expected_delivery_date: data.expected_delivery_date || null,
        shipping_address: data.shipping_address || '',
        notes: data.notes || '',
        items: data.items.map((item) => ({
          item_id: item.item,
          quantity: item.quantity,
          unit_price: item.unit_price,
        })),
      };

      await createMutation.mutateAsync(payload);
      toast.success('Purchase order created successfully');
      onSuccess?.();
    } catch (error) {
      toast.error(error.message || 'Failed to create purchase order');
    }
  };

  // Calculate totals
  const watchedItems = form.watch('items');
  const totalAmount = watchedItems.reduce((sum, item) => {
    return sum + (item.quantity || 0) * (item.unit_price || 0);
  }, 0);

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          <FormField
            control={form.control}
            name="supplier"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Supplier *</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
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
                <FormDescription>Vendor for this order</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="requisition"
            render={({ field }) => (
              <FormItem>
                <FormLabel>From Requisition</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Link to requisition (optional)" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {requisitions.map((req) => (
                      <SelectItem key={req.id} value={req.id.toString()}>
                        {req.requisition_number || req.number} - {req.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription>Link to an approved requisition</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          <FormField
            control={form.control}
            name="expected_delivery_date"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Expected Delivery</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="shipping_address"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Shipping Address</FormLabel>
                <FormControl>
                  <Input placeholder="Delivery location..." {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Items */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <FormLabel>Order Items *</FormLabel>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => append({ item: '', quantity: 1, unit_price: 0 })}
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
                      <FormItem className="w-24">
                        <FormControl>
                          <Input type="number" min="1" placeholder="Qty" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name={`items.${index}.unit_price`}
                    render={({ field }) => (
                      <FormItem className="w-32">
                        <FormControl>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                              $
                            </span>
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="Price"
                              className="pl-7"
                              {...field}
                            />
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="flex items-center text-sm text-muted-foreground w-24">
                    = ${((watchedItems[index]?.quantity || 0) * (watchedItems[index]?.unit_price || 0)).toFixed(2)}
                  </div>
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

          {/* Total */}
          <div className="flex justify-end pt-2 border-t">
            <div className="text-right">
              <span className="text-sm text-muted-foreground">Total: </span>
              <span className="font-mono font-semibold">${totalAmount.toFixed(2)}</span>
            </div>
          </div>
        </div>

        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Notes</FormLabel>
              <FormControl>
                <Textarea placeholder="Any additional notes for the supplier..." {...field} />
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
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Create PO
          </Button>
        </div>
      </form>
    </Form>
  );
}

export default PurchaseOrderForm;
