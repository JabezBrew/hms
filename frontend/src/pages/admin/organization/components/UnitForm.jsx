import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
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
import { useUnitTypes } from '@/hooks/useOrganization';

const unitSchema = z.object({
  code: z.string().min(1, 'Code is required').max(50),
  name: z.string().min(1, 'Name is required').max(200),
  short_name: z.string().max(50).optional(),
  description: z.string().optional(),
  unit_type: z.string().min(1, 'Unit type is required'),
  staffing_mode: z.enum(['clinical_only', 'mixed', 'ops_only']),
  ward_assignment_policy: z.enum(['flexible', 'strict']).optional(),
  location: z.string().optional(),
  floor: z.string().optional(),
  building: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  is_active: z.boolean().default(true),
  accepts_admissions: z.boolean().default(true),
  accepts_referrals: z.boolean().default(true),
  has_own_budget: z.boolean().default(false),
  operates_24_hours: z.boolean().default(false),
});

/**
 * UnitForm - Form for creating/editing clinical units
 * Uses Chronicle Design System styling
 */
export function UnitForm({ unit, parentUnit, onSubmit, onCancel, isLoading }) {
  const { data: unitTypesData } = useUnitTypes();
  // apiClient.get() auto-extracts results array from paginated responses
  const unitTypes = Array.isArray(unitTypesData) ? unitTypesData : [];

  // Filter unit types based on parent - child units can't be root types
  const availableTypes = parentUnit
    ? unitTypes.filter((type) => !type.can_be_root)
    : unitTypes;

  const form = useForm({
    resolver: zodResolver(unitSchema),
    defaultValues: {
      code: unit?.code || '',
      name: unit?.name || '',
      short_name: unit?.short_name || '',
      description: unit?.description || '',
      unit_type: unit?.unit_type?.toString() || '',
      staffing_mode: unit?.staffing_mode || 'clinical_only',
      ward_assignment_policy: unit?.ward_assignment_policy || 'flexible',
      location: unit?.location || '',
      floor: unit?.floor || '',
      building: unit?.building || '',
      phone: unit?.phone || '',
      email: unit?.email || '',
      is_active: unit?.is_active ?? true,
      accepts_admissions: unit?.accepts_admissions ?? true,
      accepts_referrals: unit?.accepts_referrals ?? true,
      has_own_budget: unit?.has_own_budget ?? false,
      operates_24_hours: unit?.operates_24_hours ?? false,
    },
  });

  const selectedUnitTypeId = form.watch('unit_type');
  const staffingModeDirty = !!form.formState.dirtyFields?.staffing_mode;

  useEffect(() => {
    if (unit || staffingModeDirty) {
      return;
    }

    const selectedType = unitTypes.find((type) => type.id.toString() === selectedUnitTypeId);
    if (!selectedType) {
      return;
    }

    const defaultMode = ['facility', 'department', 'division'].includes(selectedType.code)
      ? 'mixed'
      : 'clinical_only';
    form.setValue('staffing_mode', defaultMode, { shouldDirty: false });
  }, [unit, staffingModeDirty, selectedUnitTypeId, unitTypes, form]);

  const handleSubmit = (data) => {
    // Remove empty/null values - don't send them to API
    const cleanedData = {};
    Object.keys(data).forEach((key) => {
      const value = data[key];
      if (value !== '' && value !== null && value !== undefined) {
        cleanedData[key] = value;
      }
    });
    onSubmit(cleanedData);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-8">
        {/* Basic Info Section */}
        <section className="space-y-4">
          <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Basic Information
          </h3>

          <FormField
            control={form.control}
            name="unit_type"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="font-mono text-xs uppercase tracking-wider">Unit Type *</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger className="font-mono text-sm">
                      <SelectValue placeholder="Select unit type" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent className="z-[200]">
                    {availableTypes.map((type) => (
                      <SelectItem key={type.id} value={type.id.toString()}>
                        {type.name}
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
            name="staffing_mode"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="font-mono text-xs uppercase tracking-wider">Staffing Mode *</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger className="font-mono text-sm">
                      <SelectValue placeholder="Select staffing mode" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent className="z-[200]">
                    <SelectItem value="clinical_only">Clinical (Practitioner Only)</SelectItem>
                    <SelectItem value="mixed">Mixed (Clinical + Operations)</SelectItem>
                    <SelectItem value="ops_only">Operations (Non-Clinical Only)</SelectItem>
                  </SelectContent>
                </Select>
                <FormDescription className="text-[10px] text-muted-foreground">
                  Defaults to mixed for facility/department/division; not inherited from parent units
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="ward_assignment_policy"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="font-mono text-xs uppercase tracking-wider">Ward Assignment Policy</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger className="font-mono text-sm">
                      <SelectValue placeholder="Select policy" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent className="z-[200]">
                    <SelectItem value="flexible">Flexible - Patient stays with admitting team</SelectItem>
                    <SelectItem value="strict">Strict - Patient transfers to ward&apos;s team</SelectItem>
                  </SelectContent>
                </Select>
                <FormDescription className="text-[10px] text-muted-foreground">
                  Controls team handoff when patient is placed in a ward owned by a different team
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-mono text-xs uppercase tracking-wider">Code *</FormLabel>
                  <FormControl>
                    <Input placeholder="SURG" className="font-mono" {...field} />
                  </FormControl>
                  <FormDescription className="text-[10px] text-muted-foreground">Short identifier</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="short_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-mono text-xs uppercase tracking-wider">Short Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Surgery" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="font-mono text-xs uppercase tracking-wider">Full Name *</FormLabel>
                <FormControl>
                  <Input placeholder="Surgery Department" className="font-display" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="font-mono text-xs uppercase tracking-wider">Description</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="Description of the unit..."
                    className="resize-none text-sm"
                    rows={3}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </section>

        <div className="divider-gradient" />

        {/* Location Section */}
        <section className="space-y-4">
          <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Location
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="building"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-mono text-xs uppercase tracking-wider">Building</FormLabel>
                  <FormControl>
                    <Input placeholder="Main Building" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="floor"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-mono text-xs uppercase tracking-wider">Floor</FormLabel>
                  <FormControl>
                    <Input placeholder="3rd Floor" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="location"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="font-mono text-xs uppercase tracking-wider">Location Details</FormLabel>
                <FormControl>
                  <Input placeholder="Wing A, Room 301" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </section>

        <div className="divider-gradient" />

        {/* Contact Section */}
        <section className="space-y-4">
          <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Contact
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-mono text-xs uppercase tracking-wider">Phone</FormLabel>
                  <FormControl>
                    <Input placeholder="+1 234 567 8900" className="font-mono" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="font-mono text-xs uppercase tracking-wider">Email</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="unit@hospital.com" className="font-mono" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </section>

        <div className="divider-gradient" />

        {/* Capabilities Section */}
        <section className="space-y-4">
          <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Capabilities
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="is_active"
              render={({ field }) => (
                <FormItem className="flex items-center gap-3 space-y-0 rounded-lg border p-3">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <div className="space-y-0.5">
                    <FormLabel className="text-sm font-medium">Active</FormLabel>
                    <FormDescription className="text-[10px]">Unit is operational</FormDescription>
                  </div>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="accepts_admissions"
              render={({ field }) => (
                <FormItem className="flex items-center gap-3 space-y-0 rounded-lg border p-3">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <div className="space-y-0.5">
                    <FormLabel className="text-sm font-medium">Accepts Admissions</FormLabel>
                    <FormDescription className="text-[10px]">Can be primary team</FormDescription>
                  </div>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="accepts_referrals"
              render={({ field }) => (
                <FormItem className="flex items-center gap-3 space-y-0 rounded-lg border p-3">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <div className="space-y-0.5">
                    <FormLabel className="text-sm font-medium">Accepts Referrals</FormLabel>
                    <FormDescription className="text-[10px]">Can receive consults</FormDescription>
                  </div>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="has_own_budget"
              render={({ field }) => (
                <FormItem className="flex items-center gap-3 space-y-0 rounded-lg border p-3">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <div className="space-y-0.5">
                    <FormLabel className="text-sm font-medium">Has Own Budget</FormLabel>
                    <FormDescription className="text-[10px]">Separate cost center</FormDescription>
                  </div>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="operates_24_hours"
              render={({ field }) => (
                <FormItem className="flex items-center gap-3 space-y-0 rounded-lg border p-3 col-span-2">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <div className="space-y-0.5">
                    <FormLabel className="text-sm font-medium">24/7 Operations</FormLabel>
                    <FormDescription className="text-[10px]">Unit operates around the clock</FormDescription>
                  </div>
                </FormItem>
              )}
            />
          </div>
        </section>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t">
          <Button type="button" variant="outline" onClick={onCancel} className="font-mono text-xs">
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={isLoading}
            className="bg-amber-600 hover:bg-amber-700 text-white font-mono text-xs"
          >
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {unit ? 'Update Unit' : 'Create Unit'}
          </Button>
        </div>
      </form>
    </Form>
  );
}
