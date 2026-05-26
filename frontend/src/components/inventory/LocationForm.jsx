import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
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
  useCreateStorageLocation,
  useUpdateStorageLocation,
} from '@/features/inventory/hooks';
import { toast } from 'sonner';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2.js';
import Save from 'lucide-react/dist/esm/icons/save.js';

const LOCATION_TYPES = [
  { value: 'warehouse', label: 'Warehouse' },
  { value: 'pharmacy', label: 'Pharmacy' },
  { value: 'ward', label: 'Ward' },
  { value: 'department', label: 'Department' },
  { value: 'store', label: 'Store' },
];

const TEMP_ZONES = [
  { value: 'ambient', label: 'Ambient (15-25°C)' },
  { value: 'cold', label: 'Cold Storage (2-8°C)' },
  { value: 'frozen', label: 'Frozen (-20°C)' },
  { value: 'controlled', label: 'Controlled Room' },
];

const formSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  code: z.string().min(2, 'Code must be at least 2 characters'),
  description: z.string().optional(),
  location_type: z.string().min(1, 'Location type is required'),
  parent: z.string().optional(),
  temperature_zone: z.string().optional(),
  is_active: z.boolean().default(true),
  can_receive_stock: z.boolean().default(true),
  can_dispense: z.boolean().default(true),
  requires_batch_tracking: z.boolean().default(true),
});

/**
 * LocationForm - Create/edit form for storage locations
 */
export function LocationForm({ location, onSuccess, onCancel }) {
  const isEditing = Boolean(location?.id);

  const { data: locationsData } = useStorageLocations({ page_size: 100 });
  const locations = locationsData?.results || locationsData || [];

  const createMutation = useCreateStorageLocation();
  const updateMutation = useUpdateStorageLocation();

  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: location?.name || '',
      code: location?.code || '',
      description: location?.description || '',
      location_type: location?.location_type || '',
      parent: location?.parent?.toString() || '',
      temperature_zone: location?.temperature_zone || 'ambient',
      is_active: location?.is_active !== false,
      can_receive_stock: location?.can_receive_stock !== false,
      can_dispense: location?.can_dispense !== false,
      requires_batch_tracking: location?.requires_batch_tracking !== false,
    },
  });

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  const onSubmit = async (data) => {
    try {
      const payload = {
        ...data,
        parent: data.parent && data.parent !== 'none' ? data.parent : null,
      };

      if (isEditing) {
        await updateMutation.mutateAsync({ id: location.id, data: payload });
        toast.success('Location updated successfully');
      } else {
        await createMutation.mutateAsync(payload);
        toast.success('Location created successfully');
      }

      onSuccess?.();
    } catch (error) {
      toast.error(error.message || `Failed to ${isEditing ? 'update' : 'create'} location`);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Basic Info */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Name *</FormLabel>
                <FormControl>
                  <Input placeholder="Main Pharmacy" {...field} />
                </FormControl>
                <FormDescription>Display name for this location</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="code"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Code *</FormLabel>
                <FormControl>
                  <Input placeholder="PHARM-01" className="font-mono" {...field} />
                </FormControl>
                <FormDescription>Unique identifier for this location</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Main pharmacy storage for dispensing medications..."
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
          <FormField
            control={form.control}
            name="location_type"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Location Type *</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {LOCATION_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription>Category of storage area</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="parent"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Parent Location</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select parent (optional)" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {locations
                      .filter((loc) => loc.id !== location?.id)
                      .map((loc) => (
                        <SelectItem key={loc.id} value={loc.id.toString()}>
                          {loc.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <FormDescription>Assign to a parent location for hierarchy</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="temperature_zone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Temperature Zone</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select zone" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {TEMP_ZONES.map((zone) => (
                    <SelectItem key={zone.value} value={zone.value}>
                      {zone.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Settings */}
        <div className="space-y-4 pt-4 border-t">
          <h3 className="font-medium">Settings</h3>

          <FormField
            control={form.control}
            name="is_active"
            render={({ field }) => (
              <FormItem className="flex items-center justify-between rounded-lg border p-3">
                <div className="space-y-0.5">
                  <FormLabel>Active</FormLabel>
                  <FormDescription>Location is available for use</FormDescription>
                </div>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="can_receive_stock"
            render={({ field }) => (
              <FormItem className="flex items-center justify-between rounded-lg border p-3">
                <div className="space-y-0.5">
                  <FormLabel>Can Receive Stock</FormLabel>
                  <FormDescription>Allow incoming transfers and GRNs</FormDescription>
                </div>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="can_dispense"
            render={({ field }) => (
              <FormItem className="flex items-center justify-between rounded-lg border p-3">
                <div className="space-y-0.5">
                  <FormLabel>Can Dispense</FormLabel>
                  <FormDescription>Allow outgoing stock movements</FormDescription>
                </div>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="requires_batch_tracking"
            render={({ field }) => (
              <FormItem className="flex items-center justify-between rounded-lg border p-3">
                <div className="space-y-0.5">
                  <FormLabel>Batch Tracking Required</FormLabel>
                  <FormDescription>Enforce batch selection for all movements</FormDescription>
                </div>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
              </FormItem>
            )}
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? (
              <Loader2 className="size-4 mr-2 animate-spin" />
            ) : (
              <Save className="size-4 mr-2" />
            )}
            {isEditing ? 'Update Location' : 'Create Location'}
          </Button>
        </div>
      </form>
    </Form>
  );
}

export default LocationForm;
