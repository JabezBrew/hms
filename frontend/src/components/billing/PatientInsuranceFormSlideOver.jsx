/* oxlint-disable react-doctor/prefer-useReducer -- These components keep independent UI states; a reducer would add dispatch indirection without a shared transition invariant. */
import X from 'lucide-react/dist/esm/icons/x.js';
import Shield from 'lucide-react/dist/esm/icons/shield.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import { useState } from 'react';
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
} from '@/features/billing/hooks';
import { toast } from 'sonner';
import format from 'date-fns/format';
import parseISO from 'date-fns/parseISO';
import PatientSelector from '@/components/patients/PatientSelector';

const INSURANCE_FORM_ID = 'patient-insurance-form';

function getInsuranceFormKey(insurance, defaultPatient) {
  if (insurance) {
    return `edit-${insurance.id}`;
  }
  return `create-${defaultPatient?.id || 'none'}`;
}

function createInsuranceDraft(insurance, defaultPatient) {
  if (insurance) {
    return {
      formData: {
        patient: insurance.patient || '',
        plan: insurance.plan || '',
        policy_number: insurance.policy_number || '',
        is_active: insurance.is_active ?? true,
        notes: insurance.notes || '',
      },
      validFrom: insurance.valid_from ? parseISO(insurance.valid_from) : null,
      validUntil: insurance.valid_until ? parseISO(insurance.valid_until) : null,
      selectedPatient: insurance.patient_details || null,
      selectedProviderId: insurance.plan_details?.provider || '',
    };
  }

  return {
    formData: {
      patient: defaultPatient?.id || '',
      plan: '',
      policy_number: '',
      is_active: true,
      notes: '',
    },
    validFrom: null,
    validUntil: null,
    selectedPatient: defaultPatient || null,
    selectedProviderId: '',
  };
}

function getSelectedPatientName(selectedPatient) {
  if (selectedPatient?.name) {
    return selectedPatient.name;
  }

  if (selectedPatient?.local_data?.user_details) {
    const { first_name: firstName, last_name: lastName } = selectedPatient.local_data.user_details;
    return `${firstName} ${lastName}`;
  }

  return 'Selected Patient';
}

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
  if (!open) {
    return null;
  }

  return (
    <PatientInsuranceFormContent
      key={getInsuranceFormKey(insurance, defaultPatient)}
      open={open}
      onClose={onClose}
      insurance={insurance}
      defaultPatient={defaultPatient}
    />
  );
}

function InsuranceFormHeader({ isEditing, onClose }) {
  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-[oklch(0.70_0.15_230_/_0.1)]">
          <Shield className="size-5 text-[oklch(0.70_0.15_230)]" />
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
        <X className="size-4" />
      </Button>
    </header>
  );
}

function PatientSelectionField({
  error,
  isFixedPatient,
  selectedPatient,
  onPatientSelect,
}) {
  return (
    <div className="space-y-2">
      <Label className="font-mono text-xs uppercase tracking-wider">
        Patient <span className="text-destructive">*</span>
      </Label>
      {isFixedPatient ? (
        <div className="flex items-center gap-2 p-3 bg-muted/30 rounded-lg border border-border">
          <Shield className="size-4 text-muted-foreground" />
          <span className="text-foreground font-medium">
            {getSelectedPatientName(selectedPatient)}
          </span>
        </div>
      ) : (
        <PatientSelector
          selectedPatient={selectedPatient}
          onPatientSelect={onPatientSelect}
          placeholder="Select a patient"
        />
      )}
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}

function InsuranceProviderField({
  providers,
  selectedProviderId,
  onProviderChange,
}) {
  return (
    <div className="space-y-2">
      <Label className="font-mono text-xs uppercase tracking-wider">
        Insurance Provider <span className="text-destructive">*</span>
      </Label>
      <Select
        value={selectedProviderId}
        onValueChange={onProviderChange}
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
  );
}

function InsurancePlanField({
  error,
  planId,
  plans,
  selectedProviderId,
  onPlanChange,
}) {
  return (
    <div className="space-y-2">
      <Label className="font-mono text-xs uppercase tracking-wider">
        Insurance Plan <span className="text-destructive">*</span>
      </Label>
      <Select
        value={planId}
        onValueChange={onPlanChange}
        disabled={!selectedProviderId}
      >
        <SelectTrigger className={cn(error && 'border-destructive')}>
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
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}

function PolicyNumberField({ error, value, onChange }) {
  return (
    <div className="space-y-2">
      <Label htmlFor="policy_number" className="font-mono text-xs uppercase tracking-wider">
        Policy Number <span className="text-destructive">*</span>
      </Label>
      <Input
        id="policy_number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn('font-mono', error && 'border-destructive')}
        placeholder="e.g., POL-12345678"
      />
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}

function ValidityPeriodField({
  errors,
  validFrom,
  validUntil,
  onValidFromChange,
  onValidUntilChange,
}) {
  return (
    <div className="space-y-2">
      <Label className="font-mono text-xs uppercase tracking-wider">
        Validity Period <span className="text-destructive">*</span>
      </Label>
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <DatePicker
            date={validFrom}
            setDate={onValidFromChange}
            placeholder="Start date"
            className={cn('w-full font-mono', errors.valid_from && 'border-destructive')}
          />
        </div>
        <span className="text-muted-foreground text-sm">to</span>
        <div className="flex-1">
          <DatePicker
            date={validUntil}
            setDate={onValidUntilChange}
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
  );
}

function ActiveStatusField({ checked, onCheckedChange }) {
  return (
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
        checked={checked}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}

function InsuranceNotesField({ value, onChange }) {
  return (
    <div className="space-y-2">
      <Label htmlFor="notes" className="font-mono text-xs uppercase tracking-wider">
        Notes
      </Label>
      <Textarea
        id="notes"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Any additional notes..."
        rows={3}
      />
    </div>
  );
}

function InsuranceFormFields({
  defaultPatient,
  errors,
  formData,
  isEditing,
  plans,
  providers,
  selectedPatient,
  selectedProviderId,
  validFrom,
  validUntil,
  onFieldChange,
  onPatientSelect,
  onProviderChange,
  onValidFromChange,
  onValidUntilChange,
}) {
  return (
    <>
      <PatientSelectionField
        error={errors.patient}
        isFixedPatient={Boolean(isEditing || defaultPatient)}
        selectedPatient={selectedPatient}
        onPatientSelect={onPatientSelect}
      />

      <InsuranceProviderField
        providers={providers}
        selectedProviderId={selectedProviderId}
        onProviderChange={onProviderChange}
      />

      <InsurancePlanField
        error={errors.plan}
        planId={formData.plan}
        plans={plans}
        selectedProviderId={selectedProviderId}
        onPlanChange={(value) => onFieldChange('plan', value)}
      />

      <PolicyNumberField
        error={errors.policy_number}
        value={formData.policy_number}
        onChange={(value) => onFieldChange('policy_number', value)}
      />

      <ValidityPeriodField
        errors={errors}
        validFrom={validFrom}
        validUntil={validUntil}
        onValidFromChange={onValidFromChange}
        onValidUntilChange={onValidUntilChange}
      />

      <ActiveStatusField
        checked={formData.is_active}
        onCheckedChange={(checked) => onFieldChange('is_active', checked)}
      />

      <InsuranceNotesField
        value={formData.notes}
        onChange={(value) => onFieldChange('notes', value)}
      />
    </>
  );
}

function InsuranceFormFooter({ isEditing, isPending, onClose }) {
  return (
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
        type="submit"
        form={INSURANCE_FORM_ID}
        disabled={isPending}
        className="font-mono text-xs"
      >
        {isPending ? (
          <>
            <Loader2 className="size-4 mr-2 animate-spin" />
            {isEditing ? 'Updating...' : 'Creating...'}
          </>
        ) : (
          <>
            <Shield className="size-4 mr-2" />
            {isEditing ? 'Update Insurance' : 'Add Insurance'}
          </>
        )}
      </Button>
    </footer>
  );
}

function PatientInsuranceFormContent({
  open,
  onClose,
  insurance = null,
  defaultPatient = null,
}) {
  const isEditing = !!insurance;

  const createMutation = useCreatePatientInsurance();
  const updateMutation = useUpdatePatientInsurance();
  const initialDraft = createInsuranceDraft(insurance, defaultPatient);

  // Fetch providers and plans
  const { data: providersData } = useInsuranceProviders({}, { enabled: open });
  const providers = providersData?.results || providersData || [];

  const [selectedProviderId, setSelectedProviderId] = useState(initialDraft.selectedProviderId);
  const { data: plansData } = useInsurancePlans(
    selectedProviderId ? { provider: selectedProviderId } : {},
    { enabled: open && !!selectedProviderId }
  );
  const plans = plansData?.results || plansData || [];

  // Form state
  const [formData, setFormData] = useState(initialDraft.formData);
  const [validFrom, setValidFrom] = useState(initialDraft.validFrom);
  const [validUntil, setValidUntil] = useState(initialDraft.validUntil);
  const [selectedPatient, setSelectedPatient] = useState(initialDraft.selectedPatient);
  const [errors, setErrors] = useState({});

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
      <InsuranceFormHeader isEditing={isEditing} onClose={onClose} />

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <form id={INSURANCE_FORM_ID} onSubmit={handleSubmit} className="space-y-5">
          <InsuranceFormFields
            defaultPatient={defaultPatient}
            errors={errors}
            formData={formData}
            isEditing={isEditing}
            plans={plans}
            providers={providers}
            selectedPatient={selectedPatient}
            selectedProviderId={selectedProviderId}
            validFrom={validFrom}
            validUntil={validUntil}
            onFieldChange={handleChange}
            onPatientSelect={handlePatientSelect}
            onProviderChange={handleProviderChange}
            onValidFromChange={setValidFrom}
            onValidUntilChange={setValidUntil}
          />
        </form>
      </div>

      <InsuranceFormFooter
        isEditing={isEditing}
        isPending={isPending}
        onClose={onClose}
      />
    </div>
  );
}
