import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { cn } from '@/lib/utils';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  useDispenseControlledSubstance,
  useRecordControlledCount,
  useRecordControlledWastage,
} from '@/features/inventory/hooks';
import { useStaff } from '@/features/staff/hooks';
import { useAuth } from '@/lib/auth';
import { isRustV2ApiMode } from '@/lib/api/v2/runtime';
import { toast } from 'sonner';
import Shield from 'lucide-react/dist/esm/icons/shield.js';
import Pill from 'lucide-react/dist/esm/icons/pill.js';
import ClipboardCheck from 'lucide-react/dist/esm/icons/clipboard-check.js';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js';
import User from 'lucide-react/dist/esm/icons/user.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2.js';

function staffOptionsFromResponse(staffData) {
  if (Array.isArray(staffData)) {
    return staffData;
  }
  if (Array.isArray(staffData?.results)) {
    return staffData.results;
  }
  return [];
}

function staffUserId(staff) {
  return staff?.user_id || staff?.user?.id || staff?.id || '';
}

function staffDisplayName(staff) {
  return staff?.name || staff?.display_name || staff?.email || staffUserId(staff);
}

function currentUserWitnessOption(user) {
  if (!user?.id) {
    return null;
  }
  const displayName = user.display_name
    || [user.first_name, user.last_name].filter(Boolean).join(' ').trim()
    || user.email
    || user.id;
  return {
    user_id: user.id,
    name: displayName,
    display_name: displayName,
    email: user.email || '',
  };
}

function witnessOptionsFrom(staffData, user) {
  const staffOptions = staffOptionsFromResponse(staffData);
  if (staffOptions.length > 0) {
    return staffOptions;
  }
  const currentUserOption = currentUserWitnessOption(user);
  return currentUserOption ? [currentUserOption] : [];
}

function requireWitness(form, data, rustV2Mode) {
  if (rustV2Mode) {
    if (!data.witness_user_id) {
      form.setError('witness_user_id', {
        type: 'manual',
        message: 'Witness is required',
      });
      return false;
    }
    return true;
  }

  if (!String(data.witness_name || '').trim()) {
    form.setError('witness_name', {
      type: 'manual',
      message: 'Witness name is required',
    });
    return false;
  }
  return true;
}

function WitnessVerificationSection({
  form,
  rustV2Mode,
  staffOptions,
  staffLoading,
  description,
}) {
  return (
    <Card className="bg-amber-500/5 border-amber-500/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <User className="size-4 text-amber-500" />
          Witness Verification
        </CardTitle>
        <CardDescription className="text-xs">
          {description}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {rustV2Mode ? (
          <FormField
            control={form.control}
            name="witness_user_id"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Witness *</FormLabel>
                <Select
                  onValueChange={(value) => {
                    const selectedStaff = staffOptions.find((staff) => (
                      String(staffUserId(staff)) === String(value)
                    ));
                    field.onChange(value);
                    form.setValue('witness_name', staffDisplayName(selectedStaff), {
                      shouldDirty: true,
                      shouldValidate: true,
                    });
                  }}
                  value={field.value}
                  disabled={staffLoading}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder={staffLoading ? 'Loading staff...' : 'Select witness'} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {staffOptions.map((staff) => {
                      const userId = staffUserId(staff);
                      if (!userId) {
                        return null;
                      }
                      return (
                        <SelectItem key={userId} value={String(userId)}>
                          {staffDisplayName(staff)}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : (
          <>
            <FormField
              control={form.control}
              name="witness_name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Witness Name *</FormLabel>
                  <FormControl>
                    <Input placeholder="Full name of witness" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="witness_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Witness ID/Badge</FormLabel>
                  <FormControl>
                    <Input placeholder="Staff ID" className="font-mono" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

// =========================================================================
// Dispense Form
// =========================================================================

const dispenseSchema = z.object({
  quantity: z.coerce.number().min(1, 'Quantity must be at least 1'),
  patient_name: z.string().min(2, 'Patient name is required'),
  patient_mrn: z.string().optional(),
  prescription_number: z.string().optional(),
  batch_number: z.string().optional(),
  witness_name: z.string().optional(),
  witness_id: z.string().optional(),
  witness_user_id: z.string().optional(),
  notes: z.string().optional(),
});

/**
 * ControlledDispenseForm - Form for dispensing controlled substances
 */
export function ControlledDispenseForm({
  register,
  open,
  onOpenChange,
  onSuccess,
}) {
  const dispenseMutation = useDispenseControlledSubstance();
  const { user } = useAuth();
  const rustV2Mode = isRustV2ApiMode();
  const { data: staffData = [], isLoading: staffLoading } = useStaff(
    { page_size: 100 },
    { enabled: rustV2Mode && open },
  );
  const staffOptions = witnessOptionsFrom(staffData, user);

  const form = useForm({
    resolver: zodResolver(dispenseSchema),
    defaultValues: {
      quantity: 1,
      patient_name: '',
      patient_mrn: '',
      prescription_number: '',
      batch_number: '',
      witness_name: '',
      witness_id: '',
      witness_user_id: '',
      notes: '',
    },
  });

  const onSubmit = async (data) => {
    if (!requireWitness(form, data, rustV2Mode)) {
      return;
    }

    try {
      await dispenseMutation.mutateAsync({
        register: register.id,
        item_id: register.item_id,
        location_id: register.location_id,
        ...data,
      });
      toast.success('Controlled substance dispensed');
      form.reset();
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      toast.error(error.message || 'Failed to dispense');
    }
  };

  const currentBalance = register?.current_balance || 0;
  const watchQuantity = form.watch('quantity') || 0;
  const newBalance = currentBalance - watchQuantity;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pill className="size-5 text-rose-500" />
            Dispense Controlled Substance
          </DialogTitle>
          <DialogDescription>
            Record dispensing of {register?.item_name || 'controlled substance'}.
            A witness signature is required.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Balance Display */}
            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
              <div>
                <p className="text-xs text-muted-foreground">Current Balance</p>
                <p className="text-xl font-mono font-semibold">{currentBalance}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Dispense</p>
                <p className="text-xl font-mono font-semibold text-rose-500">-{watchQuantity}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">New Balance</p>
                <p className={cn(
                  'text-xl font-mono font-semibold',
                  newBalance < 0 && 'text-rose-500'
                )}>
                  {newBalance}
                </p>
              </div>
            </div>

            {newBalance < 0 && (
              <div className="flex items-center gap-2 p-3 bg-rose-500/10 text-rose-500 rounded-lg text-sm">
                <AlertTriangle className="size-4" />
                Quantity exceeds available balance
              </div>
            )}

            {/* Quantity */}
            <FormField
              control={form.control}
              name="quantity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Quantity *</FormLabel>
                  <FormControl>
                    <Input type="number" min="1" max={currentBalance} className="font-mono" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Patient Information */}
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="patient_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Patient Name *</FormLabel>
                    <FormControl>
                      <Input placeholder="Full name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="patient_mrn"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>MRN</FormLabel>
                    <FormControl>
                      <Input placeholder="Medical Record #" className="font-mono" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Prescription */}
            <FormField
              control={form.control}
              name="prescription_number"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Prescription Number</FormLabel>
                  <FormControl>
                    <Input placeholder="Rx number" className="font-mono" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Batch */}
            <FormField
              control={form.control}
              name="batch_number"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Batch Number</FormLabel>
                  <FormControl>
                    <Input placeholder="Select batch" className="font-mono" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Witness Section */}
            <WitnessVerificationSection
              form={form}
              rustV2Mode={rustV2Mode}
              staffOptions={staffOptions}
              staffLoading={staffLoading}
              description="A second authorized staff member must verify this transaction"
            />

            {/* Notes */}
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Additional notes..." rows={2} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={dispenseMutation.isPending || newBalance < 0}
                className="bg-rose-600 hover:bg-rose-700"
              >
                {dispenseMutation.isPending ? (
                  <Loader2 className="size-4 mr-2 animate-spin" />
                ) : (
                  <Pill className="size-4 mr-2" />
                )}
                Dispense
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// =========================================================================
// Physical Count Form
// =========================================================================

const countSchema = z.object({
  actual_count: z.coerce.number().min(0, 'Count must be 0 or greater'),
  witness_name: z.string().optional(),
  witness_id: z.string().optional(),
  witness_user_id: z.string().optional(),
  notes: z.string().optional(),
});

/**
 * ControlledCountForm - Form for physical count of controlled substances
 */
export function ControlledCountForm({
  register,
  open,
  onOpenChange,
  onSuccess,
}) {
  const countMutation = useRecordControlledCount();
  const { user } = useAuth();
  const rustV2Mode = isRustV2ApiMode();
  const { data: staffData = [], isLoading: staffLoading } = useStaff(
    { page_size: 100 },
    { enabled: rustV2Mode && open },
  );
  const staffOptions = witnessOptionsFrom(staffData, user);

  const form = useForm({
    resolver: zodResolver(countSchema),
    defaultValues: {
      actual_count: register?.current_balance || 0,
      witness_name: '',
      witness_id: '',
      witness_user_id: '',
      notes: '',
    },
  });

  const onSubmit = async (data) => {
    if (!requireWitness(form, data, rustV2Mode)) {
      return;
    }

    const expectedBalance = register?.current_balance || 0;
    const discrepancy = data.actual_count - expectedBalance;
    const countReason = String(data.notes || '').trim();

    if (rustV2Mode && discrepancy !== 0 && !countReason) {
      form.setError('notes', {
        type: 'manual',
        message: 'Reason is required when the count does not match the register balance.',
      });
      return;
    }

    try {
      await countMutation.mutateAsync({
        register: register.id,
        ...data,
        ...(rustV2Mode
          ? {
              category: discrepancy < 0 ? 'missing' : discrepancy > 0 ? 'surplus' : 'other',
              reason: countReason || 'Physical count verified',
              notes: countReason || null,
            }
          : {}),
      });
      if (discrepancy !== 0) {
        toast.warning(`Count recorded with discrepancy of ${discrepancy > 0 ? '+' : ''}${discrepancy}`);
      } else {
        toast.success('Count verified - no discrepancy');
      }
      form.reset();
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      toast.error(error.message || 'Failed to record count');
    }
  };

  const expectedBalance = register?.current_balance || 0;
  const watchCount = form.watch('actual_count');
  const discrepancy = (watchCount || 0) - expectedBalance;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardCheck className="size-5 text-sky-500" />
            Physical Count
          </DialogTitle>
          <DialogDescription>
            Record a physical count of {register?.item_name || 'controlled substance'}.
            Any discrepancy will be flagged for investigation.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Balance Display */}
            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
              <div>
                <p className="text-xs text-muted-foreground">Expected</p>
                <p className="text-xl font-mono font-semibold">{expectedBalance}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Actual</p>
                <p className="text-xl font-mono font-semibold">{watchCount || 0}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Discrepancy</p>
                <p className={cn(
                  'text-xl font-mono font-semibold',
                  discrepancy !== 0 && (discrepancy > 0 ? 'text-sky-500' : 'text-rose-500')
                )}>
                  {discrepancy > 0 ? '+' : ''}{discrepancy}
                </p>
              </div>
            </div>

            {discrepancy !== 0 && (
              <div className={cn(
                'flex items-center gap-2 p-3 rounded-lg text-sm',
                discrepancy > 0 ? 'bg-sky-500/10 text-sky-500' : 'bg-rose-500/10 text-rose-500'
              )}>
                <AlertTriangle className="size-4" />
                {discrepancy > 0
                  ? 'Overage detected - additional investigation may be required'
                  : 'Shortage detected - this will create a discrepancy record'
                }
              </div>
            )}

            {/* Count */}
            <FormField
              control={form.control}
              name="actual_count"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Actual Count *</FormLabel>
                  <FormControl>
                    <Input type="number" min="0" className="font-mono text-lg" {...field} />
                  </FormControl>
                  <FormDescription>
                    Enter the physical count of units
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Witness Section */}
            <WitnessVerificationSection
              form={form}
              rustV2Mode={rustV2Mode}
              staffOptions={staffOptions}
              staffLoading={staffLoading}
              description="A second authorized staff member must verify this count"
            />

            {/* Notes */}
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{rustV2Mode ? 'Reason / notes' : 'Notes'}</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder={rustV2Mode && discrepancy !== 0 ? 'Reason for the count discrepancy...' : 'Additional notes...'}
                      rows={2}
                      {...field}
                    />
                  </FormControl>
                  {rustV2Mode && discrepancy !== 0 && (
                    <FormDescription>
                      Required when the physical count differs from the register balance.
                    </FormDescription>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={countMutation.isPending}>
                {countMutation.isPending ? (
                  <Loader2 className="size-4 mr-2 animate-spin" />
                ) : (
                  <ClipboardCheck className="size-4 mr-2" />
                )}
                Record Count
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// =========================================================================
// Wastage Form
// =========================================================================

const wastageSchema = z.object({
  quantity: z.coerce.number().min(1, 'Quantity must be at least 1'),
  reason: z.string().min(1, 'Reason is required'),
  batch_number: z.string().optional(),
  witness_name: z.string().optional(),
  witness_id: z.string().optional(),
  witness_user_id: z.string().optional(),
  notes: z.string().optional(),
});

const WASTAGE_REASONS = [
  { value: 'expired', label: 'Expired' },
  { value: 'damaged', label: 'Damaged/Broken' },
  { value: 'contaminated', label: 'Contaminated' },
  { value: 'partial_dose', label: 'Partial Dose Unused' },
  { value: 'patient_refused', label: 'Patient Refused' },
  { value: 'medication_error', label: 'Medication Error' },
  { value: 'other', label: 'Other' },
];

/**
 * WastageForm - Form for recording controlled substance wastage
 */
export function WastageForm({
  register,
  open,
  onOpenChange,
  onSuccess,
}) {
  const wastageMutation = useRecordControlledWastage();
  const { user } = useAuth();
  const rustV2Mode = isRustV2ApiMode();
  const { data: staffData = [], isLoading: staffLoading } = useStaff(
    { page_size: 100 },
    { enabled: rustV2Mode && open },
  );
  const staffOptions = witnessOptionsFrom(staffData, user);

  const form = useForm({
    resolver: zodResolver(wastageSchema),
    defaultValues: {
      quantity: 1,
      reason: '',
      batch_number: '',
      witness_name: '',
      witness_id: '',
      witness_user_id: '',
      notes: '',
    },
  });

  const onSubmit = async (data) => {
    if (!requireWitness(form, data, rustV2Mode)) {
      return;
    }

    try {
      await wastageMutation.mutateAsync({
        register: register.id,
        item_id: register.item_id,
        location_id: register.location_id,
        ...data,
      });
      toast.success('Wastage recorded');
      form.reset();
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      toast.error(error.message || 'Failed to record wastage');
    }
  };

  const currentBalance = register?.current_balance || 0;
  const watchQuantity = form.watch('quantity') || 0;
  const newBalance = currentBalance - watchQuantity;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="size-5 text-amber-500" />
            Record Wastage
          </DialogTitle>
          <DialogDescription>
            Record disposal/wastage of {register?.item_name || 'controlled substance'}.
            A witness is required to verify destruction.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Balance Display */}
            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
              <div>
                <p className="text-xs text-muted-foreground">Current Balance</p>
                <p className="text-xl font-mono font-semibold">{currentBalance}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Wastage</p>
                <p className="text-xl font-mono font-semibold text-amber-500">-{watchQuantity}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">New Balance</p>
                <p className={cn(
                  'text-xl font-mono font-semibold',
                  newBalance < 0 && 'text-rose-500'
                )}>
                  {newBalance}
                </p>
              </div>
            </div>

            {newBalance < 0 && (
              <div className="flex items-center gap-2 p-3 bg-rose-500/10 text-rose-500 rounded-lg text-sm">
                <AlertTriangle className="size-4" />
                Quantity exceeds available balance
              </div>
            )}

            {/* Quantity */}
            <FormField
              control={form.control}
              name="quantity"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Quantity *</FormLabel>
                  <FormControl>
                    <Input type="number" min="1" max={currentBalance} className="font-mono" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Reason */}
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reason *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select reason" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {WASTAGE_REASONS.map((reason) => (
                        <SelectItem key={reason.value} value={reason.value}>
                          {reason.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Batch */}
            <FormField
              control={form.control}
              name="batch_number"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Batch Number</FormLabel>
                  <FormControl>
                    <Input placeholder="Batch being wasted" className="font-mono" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Witness Section */}
            <WitnessVerificationSection
              form={form}
              rustV2Mode={rustV2Mode}
              staffOptions={staffOptions}
              staffLoading={staffLoading}
              description="A second authorized staff member must witness the destruction"
            />

            {/* Notes */}
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Additional details about wastage..." rows={2} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={wastageMutation.isPending || newBalance < 0}
                className="bg-amber-600 hover:bg-amber-700"
              >
                {wastageMutation.isPending ? (
                  <Loader2 className="size-4 mr-2 animate-spin" />
                ) : (
                  <Trash2 className="size-4 mr-2" />
                )}
                Record Wastage
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
