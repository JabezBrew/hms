import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import { useMemo } from 'react';
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
import { useUnitTypes } from '@/features/admin/hooks';

const unitSchema = z.object({
  code: z.string().min(1, 'Code is required').max(50),
  name: z.string().min(1, 'Name is required').max(200),
  short_name: z.string().max(50).optional(),
  description: z.string().optional(),
  unit_type: z.string().min(1, 'Unit type is required'),
  unit_category: z.enum(['clinical', 'ancillary', 'ops_only']),
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

function getUnitDefaultValues(unit) {
  return {
    code: unit?.code || '',
    name: unit?.name || '',
    short_name: unit?.short_name || '',
    description: unit?.description || '',
    unit_type: unit?.unit_type?.toString() || '',
    unit_category: unit?.unit_category || 'clinical',
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
  };
}

function cleanUnitPayload(data) {
  const cleanedData = {};
  Object.keys(data).forEach((key) => {
    const value = data[key];
    if (value !== '' && value !== null && value !== undefined) {
      cleanedData[key] = value;
    }
  });
  return cleanedData;
}

function FormSection({ title, children }) {
  return (
    <section className="space-y-4">
      <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function UnitClassificationFields({
  form,
  availableTypes,
  isOpsOnlyCategory,
  onUnitTypeChange,
  onUnitCategoryChange,
  onStaffingModeChange,
}) {
  return (
    <>
      <FormField
        control={form.control}
        name="unit_type"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="font-mono text-xs uppercase tracking-wider">Unit Type *</FormLabel>
            <Select value={field.value} onValueChange={(value) => onUnitTypeChange(value, field.onChange)}>
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
        name="unit_category"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="font-mono text-xs uppercase tracking-wider">Unit Category *</FormLabel>
            <Select value={field.value} onValueChange={(value) => onUnitCategoryChange(value, field.onChange)}>
              <FormControl>
                <SelectTrigger className="font-mono text-sm">
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
              </FormControl>
              <SelectContent className="z-[200]">
                <SelectItem value="clinical">Clinical (Patient-Facing)</SelectItem>
                <SelectItem value="ancillary">Ancillary (Support Services)</SelectItem>
                <SelectItem value="ops_only">Operations Only</SelectItem>
              </SelectContent>
            </Select>
            <FormDescription className="text-[10px] text-muted-foreground">
              Clinical units see patients; Ancillary units support clinical work (Lab, Radiology)
            </FormDescription>
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
            <Select value={field.value} onValueChange={(value) => onStaffingModeChange(value, field.onChange)}>
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

      {!isOpsOnlyCategory && (
        <FormField
          control={form.control}
          name="ward_assignment_policy"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="font-mono text-xs uppercase tracking-wider">Ward Assignment Policy</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
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
      )}
    </>
  );
}

function UnitIdentityFields({ form }) {
  return (
    <>
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
    </>
  );
}

function UnitBasicInfoSection({
  form,
  availableTypes,
  isOpsOnlyCategory,
  onUnitTypeChange,
  onUnitCategoryChange,
  onStaffingModeChange,
}) {
  return (
    <FormSection title="Basic Information">
      <UnitClassificationFields
        form={form}
        availableTypes={availableTypes}
        isOpsOnlyCategory={isOpsOnlyCategory}
        onUnitTypeChange={onUnitTypeChange}
        onUnitCategoryChange={onUnitCategoryChange}
        onStaffingModeChange={onStaffingModeChange}
      />
      <UnitIdentityFields form={form} />
    </FormSection>
  );
}

function UnitLocationSection({ form }) {
  return (
    <FormSection title="Location">
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
    </FormSection>
  );
}

function UnitContactSection({ form }) {
  return (
    <FormSection title="Contact">
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
    </FormSection>
  );
}

function CapabilityCheckboxField({ form, name, label, description, className }) {
  return (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem className={className}>
          <FormControl>
            <Checkbox checked={field.value} onCheckedChange={field.onChange} />
          </FormControl>
          <div className="space-y-0.5">
            <FormLabel className="text-sm font-medium">{label}</FormLabel>
            <FormDescription className="text-[10px]">{description}</FormDescription>
          </div>
        </FormItem>
      )}
    />
  );
}

function UnitCapabilitiesSection({ form, isOpsOnlyCategory }) {
  const checkboxClassName = "flex items-center gap-3 gap-y-0 rounded-lg border p-3";

  return (
    <FormSection title="Capabilities">
      <div className="grid grid-cols-2 gap-4">
        <CapabilityCheckboxField
          form={form}
          name="is_active"
          label="Active"
          description="Unit is operational"
          className={checkboxClassName}
        />

        {!isOpsOnlyCategory && (
          <CapabilityCheckboxField
            form={form}
            name="accepts_admissions"
            label="Accepts Admissions"
            description="Can be primary team"
            className={checkboxClassName}
          />
        )}

        {!isOpsOnlyCategory && (
          <CapabilityCheckboxField
            form={form}
            name="accepts_referrals"
            label="Accepts Referrals"
            description="Can receive consults"
            className={checkboxClassName}
          />
        )}

        <CapabilityCheckboxField
          form={form}
          name="has_own_budget"
          label="Has Own Budget"
          description="Separate cost center"
          className={checkboxClassName}
        />

        <CapabilityCheckboxField
          form={form}
          name="operates_24_hours"
          label="24/7 Operations"
          description="Unit operates around the clock"
          className={`${checkboxClassName} col-span-2`}
        />
      </div>
    </FormSection>
  );
}

function UnitFormActions({ unit, onCancel, isLoading }) {
  return (
    <div className="flex justify-end gap-3 pt-4 border-t">
      <Button type="button" variant="outline" onClick={onCancel} className="font-mono text-xs">
        Cancel
      </Button>
      <Button
        type="submit"
        disabled={isLoading}
        className="bg-amber-600 hover:bg-amber-700 text-white font-mono text-xs"
      >
        {isLoading && <Loader2 className="mr-2 size-4 animate-spin" />}
        {unit ? 'Update Unit' : 'Create Unit'}
      </Button>
    </div>
  );
}

/**
 * UnitForm - Form for creating/editing clinical units
 * Uses Chronicle Design System styling
 */
export function UnitForm({ unit, parentUnit, onSubmit, onCancel, isLoading }) {
  const { data: unitTypesData } = useUnitTypes();
  const formKey = unit
    ? `unit:${unit.id || unit.code || 'edit'}`
    : `new:${parentUnit?.id || 'root'}`;

  return (
    <UnitFormContent
      key={formKey}
      unit={unit}
      parentUnit={parentUnit}
      unitTypesData={unitTypesData}
      onSubmit={onSubmit}
      onCancel={onCancel}
      isLoading={isLoading}
    />
  );
}

function UnitFormContent({ unit, parentUnit, unitTypesData, onSubmit, onCancel, isLoading }) {
  // apiClient.get() auto-extracts results array from paginated responses
  const unitTypes = useMemo(
    () => (Array.isArray(unitTypesData) ? unitTypesData : []),
    [unitTypesData]
  );
  // Filter unit types based on parent - child units can't be root types
  const availableTypes = useMemo(
    () => (parentUnit ? unitTypes.filter((type) => !type.can_be_root) : unitTypes),
    [parentUnit, unitTypes]
  );

  const form = useForm({
    resolver: zodResolver(unitSchema),
    defaultValues: getUnitDefaultValues(unit),
  });

  const selectedUnitCategory = form.watch('unit_category');
  const isOpsOnlyCategory = selectedUnitCategory === 'ops_only';

  const defaultStaffingModeForType = (unitTypeId) => {
    const selectedType = unitTypes.find((type) => type.id.toString() === unitTypeId);
    if (!selectedType) return null;
    const defaultMode = ['facility', 'department', 'division'].includes(selectedType.code)
      ? 'mixed'
      : 'clinical_only';
    return defaultMode;
  };

  const handleUnitTypeChange = (value, onChange) => {
    onChange(value);
    if (unit || form.formState.dirtyFields?.staffing_mode) return;

    const defaultMode = defaultStaffingModeForType(value);
    if (defaultMode) {
      form.setValue('staffing_mode', defaultMode, { shouldDirty: false });
    }
  };

  const handleUnitCategoryChange = (value, onChange) => {
    onChange(value);
    if (value === 'ops_only') {
      form.setValue('accepts_admissions', false);
      form.setValue('accepts_referrals', false);
      form.setValue('ward_assignment_policy', 'flexible');
      form.setValue('staffing_mode', 'ops_only');
    }
  };

  const handleStaffingModeChange = (value, onChange) => {
    onChange(value);
    if (value === 'ops_only') {
      form.setValue('accepts_admissions', false);
      form.setValue('accepts_referrals', false);
    }
  };

  const handleSubmit = (data) => onSubmit(cleanUnitPayload(data));

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-8">
        <UnitBasicInfoSection
          form={form}
          availableTypes={availableTypes}
          isOpsOnlyCategory={isOpsOnlyCategory}
          onUnitTypeChange={handleUnitTypeChange}
          onUnitCategoryChange={handleUnitCategoryChange}
          onStaffingModeChange={handleStaffingModeChange}
        />

        <div className="divider-gradient" />

        <UnitLocationSection form={form} />

        <div className="divider-gradient" />

        <UnitContactSection form={form} />

        <div className="divider-gradient" />

        <UnitCapabilitiesSection form={form} isOpsOnlyCategory={isOpsOnlyCategory} />

        <UnitFormActions unit={unit} onCancel={onCancel} isLoading={isLoading} />
      </form>
    </Form>
  );
}
