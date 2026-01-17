import X from 'lucide-react/dist/esm/icons/x.js';
import Shield from 'lucide-react/dist/esm/icons/shield.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DatePicker } from '@/components/ui/date-picker';

import {
  useCreatePatientInsurance,
  useUpdatePatientInsurance,
  useInsuranceProviders,
  useInsurancePlans,
} from '@/hooks/useBillingQueries';
import { toast } from 'sonner';
import format from 'date-fns/format';
import parseISO from 'date-fns/parseISO';
import PatientSelector from '@/components/patients/PatientSelector';

/**
 * PatientInsuranceFormSlideOver - Slide-over panel for creating/editing patient insurance
 *
 * Features:
 * - Patient search and selection
 * - Provider and plan selection (cascading)
 * - Policy number and validity dates
 * - Active status toggle
 */
export default function PatientInsuranceFormSlideOver({
  open,
  onClose,
  insurance = null, // null for create, object for edit
  defaultPatient = null, // Pre-fill patient for new insurance (from chronicle page)
}) {
  const isEditing = !!insurance;

  const createMutation = useCreatePatientInsurance();
  const updateMutation = useUpdatePatientInsurance();

  // Fetch providers and plans
  const { data: providersData } = useInsuranceProviders({}, { enabled: open });
  const providers = providersData?.results || providersData || [];

  const [selectedProviderId, setSelectedProviderId] = useState('');
  const { data: plansData } = useInsurancePlans(
    selectedProviderId ? { provider: selectedProviderId } : {},
    { enabled: open && !!selectedProviderId }
  );
  const plans = plansData?.results || plansData || [];

  // Form state
  const [formData, setFormData] = useState({
    patient: '',
    plan: '',
    policy_number: '',
    is_active: true,
    notes: '',
  });
  const [validFrom, setValidFrom] = useState(null);
  const [validUntil, setValidUntil] = useState(null);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [errors, setErrors] = useState({});

  // Reset form when panel opens
  useEffect(() => {
    if (open) {
      if (insurance) {
        // Edit mode - populate form
        setFormData({
          patient: insurance.patient || '',
          plan: insurance.plan || '',
          policy_number: insurance.policy_number || '',
          is_active: insurance.is_active ?? true,
          notes: insurance.notes || '',
        });
        setValidFrom(insurance.valid_from ? parseISO(insurance.valid_from) : null);
        setValidUntil(insurance.valid_until ? parseISO(insurance.valid_until) : null);
        setSelectedPatient(insurance.patient_details || null);
        // Set provider from plan
        if (insurance.plan_details?.provider) {
          setSelectedProviderId(insurance.plan_details.provider);
        }
      } else {
        // Create mode - reset form, optionally pre-fill patient
        setFormData({
          patient: defaultPatient?.id || '',
          plan: '',
          policy_number: '',
          is_active: true,
          notes: '',
        });
        setValidFrom(null);
        setValidUntil(null);
        setSelectedPatient(defaultPatient || null);
        setSelectedProviderId('');
      }
      setErrors({});
    }
  }, [open, insurance, defaultPatient]);

  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: null }));
    }
  };

  const handleProviderChange = (providerId) => {
    setSelectedProviderId(providerId);
    // Reset plan when provider changes
    handleChange('plan', '');
  };

  const handlePatientSelect = (patient) => {
    setSelectedPatient(patient);
    handleChange('patient', patient?.id || '');
  };

  const validate = () => {
    const newErrors = {};

    if (!formData.patient) {
      newErrors.patient = 'Please select a patient';
    }

    if (!formData.plan) {
      newErrors.plan = 'Please select an insurance plan';
    }

    if (!formData.policy_number?.trim()) {
      newErrors.policy_number = 'Policy number is required';
    }

    if (!validFrom) {
      newErrors.valid_from = 'Start date is required';
    }

    if (validUntil && validFrom && validUntil < validFrom) {
      newErrors.valid_until = 'End date must be after start date';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validate()) return;

    const payload = {
      patient: formData.patient,
      plan: formData.plan,
      policy_number: formData.policy_number.trim(),
      valid_from: validFrom ? format(validFrom, 'yyyy-MM-dd') : null,
      valid_until: validUntil ? format(validUntil, 'yyyy-MM-dd') : null,
      is_active: formData.is_active,
      notes: formData.notes?.trim() || null,
    };

    try {
      if (isEditing) {
        await updateMutation.mutateAsync({ id: insurance.id, data: payload });
        toast.success('Patient insurance updated successfully');
      } else {
        await createMutation.mutateAsync(payload);
        toast.success('Patient insurance created successfully');
      }
      onClose();
    } catch (err) {
      toast.error(err.message || `Failed to ${isEditing ? 'update' : 'create'} patient insurance`);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div
      className={cn(
        'fixed inset-y-0 right-0 z-[100] w-full lg:w-[520px] bg-background border-l border-border',
        'transform transition-transform duration-300 ease-in-out',
        'flex flex-col shadow-2xl',
        open ? 'translate-x-0' : 'translate-x-full'
      )}
    >
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-[oklch(0.70_0.15_230_/_0.1)]">
            <Shield className="h-5 w-5 text-[oklch(0.70_0.15_230)]" />
          </div>
          <div>
            <h2 className="font-display text-xl text-foreground">
              {isEditing ? 'Edit Insurance' : 'Add Patient Insurance'}
            </h2>
            <p className="font-mono text-xs text-muted-foreground">
              {isEditing ? 'Update insurance details' : 'Link insurance to patient'}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="font-mono text-xs"
        >
          <X className="h-4 w-4" />
        </Button>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Patient Selection */}
          <div className="space-y-2">
            <Label className="font-mono text-xs uppercase tracking-wider">
              Patient <span className="text-destructive">*</span>
            </Label>
            {(isEditing || defaultPatient) ? (
              <div className="flex items-center gap-2 p-3 bg-muted/30 rounded-lg border border-border">
                <Shield className="h-4 w-4 text-muted-foreground" />
                <span className="text-foreground font-medium">
                  {selectedPatient?.name ||
                   (selectedPatient?.local_data?.user_details
                     ? `${selectedPatient.local_data.user_details.first_name} ${selectedPatient.local_data.user_details.last_name}`
                     : 'Selected Patient')}
                </span>
              </div>
            ) : (
              <PatientSelector
                selectedPatient={selectedPatient}
                onPatientSelect={handlePatientSelect}
                placeholder="Select a patient"
              />
            )}
            {errors.patient && (
              <p className="text-xs text-destructive">{errors.patient}</p>
            )}
          </div>

          {/* Insurance Provider */}
          <div className="space-y-2">
            <Label className="font-mono text-xs uppercase tracking-wider">
              Insurance Provider <span className="text-destructive">*</span>
            </Label>
            <Select
              value={selectedProviderId}
              onValueChange={handleProviderChange}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent className="z-[200]">
                {providers.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id} className="font-mono text-sm">
                    {provider.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Insurance Plan */}
          <div className="space-y-2">
            <Label className="font-mono text-xs uppercase tracking-wider">
              Insurance Plan <span className="text-destructive">*</span>
            </Label>
            <Select
              value={formData.plan}
              onValueChange={(value) => handleChange('plan', value)}
              disabled={!selectedProviderId}
            >
              <SelectTrigger className={cn(errors.plan && 'border-destructive')}>
                <SelectValue placeholder={selectedProviderId ? 'Select plan' : 'Select provider first'} />
              </SelectTrigger>
              <SelectContent className="z-[200]">
                {plans.map((plan) => (
                  <SelectItem key={plan.id} value={plan.id} className="font-mono text-sm">
                    <div className="flex flex-col">
                      <span>{plan.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {plan.coverage_percentage}% coverage
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.plan && (
              <p className="text-xs text-destructive">{errors.plan}</p>
            )}
          </div>

          {/* Policy Number */}
          <div className="space-y-2">
            <Label htmlFor="policy_number" className="font-mono text-xs uppercase tracking-wider">
              Policy Number <span className="text-destructive">*</span>
            </Label>
            <Input
              id="policy_number"
              value={formData.policy_number}
              onChange={(e) => handleChange('policy_number', e.target.value)}
              className={cn('font-mono', errors.policy_number && 'border-destructive')}
              placeholder="e.g., POL-12345678"
            />
            {errors.policy_number && (
              <p className="text-xs text-destructive">{errors.policy_number}</p>
            )}
          </div>

          {/* Validity Period */}
          <div className="space-y-2">
            <Label className="font-mono text-xs uppercase tracking-wider">
              Validity Period <span className="text-destructive">*</span>
            </Label>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <DatePicker
                  date={validFrom}
                  setDate={setValidFrom}
                  placeholder="Start date"
                  className={cn('w-full font-mono', errors.valid_from && 'border-destructive')}
                />
              </div>
              <span className="text-muted-foreground text-sm">to</span>
              <div className="flex-1">
                <DatePicker
                  date={validUntil}
                  setDate={setValidUntil}
                  placeholder="No expiry"
                  className={cn('w-full font-mono', errors.valid_until && 'border-destructive')}
                />
              </div>
            </div>
            {errors.valid_from && (
              <p className="text-xs text-destructive">{errors.valid_from}</p>
            )}
            {errors.valid_until && (
              <p className="text-xs text-destructive">{errors.valid_until}</p>
            )}
            <p className="text-xs text-muted-foreground">Leave end date blank for no expiry</p>
          </div>

          {/* Active Status */}
          <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
            <div>
              <Label htmlFor="is_active" className="text-sm font-medium cursor-pointer">
                Active Status
              </Label>
              <p className="text-xs text-muted-foreground">
                Inactive insurance won't be available for billing
              </p>
            </div>
            <Switch
              id="is_active"
              checked={formData.is_active}
              onCheckedChange={(checked) => handleChange('is_active', checked)}
            />
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes" className="font-mono text-xs uppercase tracking-wider">
              Notes
            </Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => handleChange('notes', e.target.value)}
              placeholder="Any additional notes..."
              rows={3}
            />
          </div>
        </form>
      </div>

      {/* Footer */}
      <footer className="border-t border-border bg-card px-6 py-4 flex items-center justify-between">
        <Button
          variant="outline"
          onClick={onClose}
          disabled={isPending}
          className="font-mono text-xs"
        >
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={isPending}
          className="font-mono text-xs"
        >
          {isPending ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              {isEditing ? 'Updating...' : 'Creating...'}
            </>
          ) : (
            <>
              <Shield className="h-4 w-4 mr-2" />
              {isEditing ? 'Update Insurance' : 'Add Insurance'}
            </>
          )}
        </Button>
      </footer>
    </div>
  );
}
