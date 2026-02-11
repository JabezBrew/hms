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
  useStorageLocations,
  useInventoryItems,
  useCreateTransferRequest,
} from '@/features/inventory/hooks';
import { toast } from 'sonner';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2.js';
import Save from 'lucide-react/dist/esm/icons/save.js';
import Plus from 'lucide-react/dist/esm/icons/plus.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right.js';

const formSchema = z.object({
  from_location: z.string().min(1, 'Source location is required'),
  to_location: z.string().min(1, 'Destination location is required'),
  reason: z.string().min(2, 'Reason is required'),
  notes: z.string().optional(),
  items: z.array(z.object({
    item: z.string().min(1, 'Item is required'),
    quantity: z.coerce.number().min(1, 'Quantity must be at least 1'),
  })).min(1, 'At least one item is required'),
}).refine((data) => data.from_location !== data.to_location, {
  message: "Source and destination must be different",
  path: ["to_location"],
});

/**
 * TransferRequestForm - Create stock transfer request
 */
export function TransferRequestForm({ onSuccess, onCancel, initialToLocation }) {
  const { data: locationsData } = useStorageLocations({ page_size: 100 });
  const { data: itemsData } = useInventoryItems({ page_size: 200 });

  const locations = locationsData?.results || locationsData || [];
  const items = itemsData?.results || [];

  const createMutation = useCreateTransferRequest();

  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      from_location: '',
      to_location: initialToLocation || '',
      reason: '',
      notes: '',
      items: [{ item: '', quantity: 1 }],
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
        from_location: data.from_location,
        to_location: data.to_location,
        reason: data.reason,
        notes: data.notes || '',
        items: data.items.map((item) => ({
          item_id: item.item,
          requested_quantity: item.quantity,
        })),
      };

      await createMutation.mutateAsync(payload);
      toast.success('Transfer request created successfully');
      onSuccess?.();
    } catch (error) {
      toast.error(error.message || 'Failed to create transfer request');
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Locations */}
        <div className="flex items-end gap-4">
          <FormField
            control={form.control}
            name="from_location"
            render={({ field }) => (
              <FormItem className="flex-1">
                <FormLabel>From Location *</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select source" />
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
                <FormMessage />
              </FormItem>
            )}
          />

          <ArrowRight className="h-5 w-5 text-muted-foreground mb-2" />

          <FormField
            control={form.control}
            name="to_location"
            render={({ field }) => (
              <FormItem className="flex-1">
                <FormLabel>To Location *</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select destination" />
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
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="reason"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Reason *</FormLabel>
              <FormControl>
                <Input placeholder="Stock replenishment for ward..." {...field} />
              </FormControl>
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
              onClick={() => append({ item: '', quantity: 1 })}
            >
              <Plus className="h-4 w-4 mr-1" />
              Add Item
            </Button>
          </div>

          {fields.map((field, index) => (
            <div key={field.id} className="flex gap-3 items-start p-3 border rounded-lg">
              <FormField
                control={form.control}
                name={`items.${index}.item`}
                render={({ field }) => (
                  <FormItem className="flex-1">
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

              <FormField
                control={form.control}
                name={`items.${index}.quantity`}
                render={({ field }) => (
                  <FormItem className="w-28">
                    <FormControl>
                      <Input type="number" min="1" placeholder="Qty" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

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
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Create Transfer Request
          </Button>
        </div>
      </form>
    </Form>
  );
}

export default TransferRequestForm;
