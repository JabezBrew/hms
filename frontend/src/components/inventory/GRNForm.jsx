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
  usePurchaseOrders,
  useStorageLocations,
  useInventoryItems,
  useCreateGRN,
} from '@/hooks/useInventoryQueries';
import { toast } from 'sonner';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2.js';
import Save from 'lucide-react/dist/esm/icons/save.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';

const formSchema = z.object({
  purchase_order: z.string().optional(),
  receiving_location: z.string().min(1, 'Receiving location is required'),
  received_date: z.string().min(1, 'Received date is required'),
  delivery_note_number: z.string().optional(),
  notes: z.string().optional(),
  items: z.array(z.object({
    item: z.string().min(1, 'Item is required'),
    quantity_received: z.coerce.number().min(1, 'Quantity must be at least 1'),
    batch_number: z.string().optional(),
    expiry_date: z.string().optional(),
  })).min(1, 'At least one item is required'),
});

/**
 * GRNForm - Create goods received note
 */
export function GRNForm({ onSuccess, onCancel, initialPOId }) {
  const { data: posData } = usePurchaseOrders({ status: 'sent', page_size: 50 });
  const { data: locationsData } = useStorageLocations({ page_size: 100 });
  const { data: itemsData } = useInventoryItems({ page_size: 200 });

  const purchaseOrders = posData?.results || [];
  const locations = locationsData?.results || locationsData || [];
  const items = itemsData?.results || [];

  const createMutation = useCreateGRN();

  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      purchase_order: initialPOId || '',
      receiving_location: '',
      received_date: new Date().toISOString().split('T')[0],
      delivery_note_number: '',
      notes: '',
      items: [{ item: '', quantity_received: 1, batch_number: '', expiry_date: '' }],
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
        purchase_order: data.purchase_order && data.purchase_order !== 'none' ? data.purchase_order : null,
        receiving_location: data.receiving_location,
        received_date: data.received_date,
        delivery_note_number: data.delivery_note_number || '',
        notes: data.notes || '',
        items: data.items.map((item) => ({
          item_id: item.item,
          quantity_received: item.quantity_received,
          batch_number: item.batch_number || '',
          expiry_date: item.expiry_date || null,
        })),
      };

      await createMutation.mutateAsync(payload);
      toast.success('GRN created successfully');
      onSuccess?.();
    } catch (error) {
      toast.error(error.message || 'Failed to create GRN');
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          <FormField
            control={form.control}
            name="purchase_order"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Purchase Order</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Link to PO (optional)" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="none">None (Direct Receipt)</SelectItem>
                    {purchaseOrders.map((po) => (
                      <SelectItem key={po.id} value={po.id.toString()}>
                        {po.po_number || po.number} - {po.supplier_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription>Link to an existing purchase order</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="receiving_location"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Receiving Location *</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select location" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {locations.map((loc) => (
                      <SelectItem key={loc.id} value={loc.id.toString()}>
                        {loc.name} ({loc.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription>Where goods will be stored</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          <FormField
            control={form.control}
            name="received_date"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Received Date *</FormLabel>
                <FormControl>
                  <Input type="date" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="delivery_note_number"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Delivery Note #</FormLabel>
                <FormControl>
                  <Input placeholder="Supplier's delivery note number" className="font-mono" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {/* Items */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <FormLabel>Received Items *</FormLabel>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => append({ item: '', quantity_received: 1, batch_number: '', expiry_date: '' })}
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

                <div className="grid grid-cols-3 gap-3">
                  <FormField
                    control={form.control}
                    name={`items.${index}.quantity_received`}
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
                    control={form.control}
                    name={`items.${index}.batch_number`}
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Input placeholder="Batch #" className="font-mono" {...field} />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name={`items.${index}.expiry_date`}
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <Input type="date" placeholder="Expiry" {...field} />
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
                <Textarea placeholder="Any notes about the delivery condition, discrepancies, etc..." {...field} />
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
            Create GRN
          </Button>
        </div>
      </form>
    </Form>
  );
}

export default GRNForm;
