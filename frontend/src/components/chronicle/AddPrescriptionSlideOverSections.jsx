import X from 'lucide-react/dist/esm/icons/x.js';
import Pill from 'lucide-react/dist/esm/icons/pill.js';
import AlertCircle from 'lucide-react/dist/esm/icons/circle-alert.js';
import Check from 'lucide-react/dist/esm/icons/check.js';
import Calendar from 'lucide-react/dist/esm/icons/calendar.js';
import Shield from 'lucide-react/dist/esm/icons/shield.js';
import Loader2 from 'lucide-react/dist/esm/icons/loader-circle.js';
import Package from 'lucide-react/dist/esm/icons/package.js';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { MedicationAutocomplete } from '@/components/drug-safety/MedicationAutocomplete';

const ROUTE_OPTIONS = [
  { value: 'oral', label: 'Oral (PO)' },
  { value: 'iv', label: 'Intravenous (IV)' },
  { value: 'im', label: 'Intramuscular (IM)' },
  { value: 'sc', label: 'Subcutaneous (SC)' },
  { value: 'topical', label: 'Topical' },
  { value: 'inhaled', label: 'Inhaled' },
  { value: 'sublingual', label: 'Sublingual (SL)' },
  { value: 'rectal', label: 'Rectal (PR)' },
  { value: 'ophthalmic', label: 'Ophthalmic' },
  { value: 'otic', label: 'Otic (Ear)' },
  { value: 'nasal', label: 'Nasal' },
  { value: 'transdermal', label: 'Transdermal' },
  { value: 'vaginal', label: 'Vaginal' },
];

const FREQUENCY_OPTIONS = [
  { value: 'once', label: 'Once' },
  { value: 'daily', label: 'Once Daily' },
  { value: 'bid', label: 'Twice Daily (BID)' },
  { value: 'tid', label: 'Three Times Daily (TID)' },
  { value: 'qid', label: 'Four Times Daily (QID)' },
  { value: 'q4h', label: 'Every 4 Hours' },
  { value: 'q6h', label: 'Every 6 Hours' },
  { value: 'q8h', label: 'Every 8 Hours' },
  { value: 'q12h', label: 'Every 12 Hours' },
  { value: 'qhs', label: 'At Bedtime (QHS)' },
  { value: 'prn', label: 'As Needed (PRN)' },
  { value: 'stat', label: 'Immediately (STAT)' },
  { value: 'weekly', label: 'Weekly' },
];

const getRouteLabel = (value) => (
  ROUTE_OPTIONS.find((route) => route.value === value)?.label || value
);

const getFrequencyLabel = (value) => (
  FREQUENCY_OPTIONS.find((frequency) => frequency.value === value)?.label || value
);

export function PrescriptionSlideOverHeader({ patientName, onClose }) {
  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-sky-100 dark:bg-sky-900/30">
          <Pill className="size-5 text-sky-600 dark:text-sky-400" />
        </div>
        <div>
          <h2 className="font-display text-xl text-foreground">
            Prescribe Medication
          </h2>
          <p className="font-mono text-xs text-muted-foreground mt-0.5">
            {patientName}
          </p>
        </div>
      </div>

      <Button
        variant="destructive"
        size="sm"
        onClick={onClose}
        className="font-mono text-xs bg-red-500 hover:bg-red-600 text-white"
      >
        <X className="size-4 mr-1.5" />
        Close
      </Button>
    </header>
  );
}

export function PatientAllergyWarning({ allergiesData }) {
  if (!allergiesData?.allergies?.length) {
    return null;
  }

  const activeAllergies = allergiesData.allergies.reduce((allergenNames, allergy) => {
    if (allergy.is_active) {
      allergenNames.push(allergy.allergen_name);
    }
    return allergenNames;
  }, []);

  return (
    <div className="px-6 pt-4">
      <Alert variant="destructive">
        <AlertCircle className="size-4" />
        <AlertDescription>
          <span className="font-semibold">Patient Allergies ({allergiesData.count}):</span>{' '}
          {activeAllergies.join(', ')}
        </AlertDescription>
      </Alert>
    </div>
  );
}

function MedicationNameField({
  formData,
  errors,
  drugSafetyEnhancementsAvailable,
  onMedicationSelect,
  onFieldChange,
}) {
  return (
    <div className="space-y-2">
      <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
        <Shield className="size-3.5 text-sky-600" />
        {drugSafetyEnhancementsAvailable
          ? 'Medication Name * (with drug safety check)'
          : 'Medication Name *'}
      </Label>
      {drugSafetyEnhancementsAvailable ? (
        <MedicationAutocomplete
          value={formData.medication_name}
          onSelect={onMedicationSelect}
          placeholder="Search for medication..."
          className={cn(
            'font-mono',
            errors.medication_name && 'border-red-500',
          )}
        />
      ) : (
        <Input
          aria-label="Medication"
          placeholder="Enter medication name..."
          value={formData.medication_name}
          onChange={(event) => onFieldChange('medication_name', event.target.value)}
          className={cn(
            'font-mono',
            errors.medication_name && 'border-red-500',
          )}
        />
      )}
      <p className="text-xs text-muted-foreground">
        {drugSafetyEnhancementsAvailable
          ? 'Drug interactions and allergy checks will be performed automatically'
          : 'Drug interaction checks are not exposed in Rust V2 yet; patient allergy warnings remain visible.'}
      </p>
      {errors.medication_name && (
        <p className="text-xs text-red-500">{errors.medication_name}</p>
      )}
    </div>
  );
}

function DrugFormSelector({
  drugSafetyEnhancementsAvailable,
  selectedRxcui,
  drugForms,
  isLoadingForms,
  onDrugFormSelect,
}) {
  if (!drugSafetyEnhancementsAvailable || !selectedRxcui) {
    return null;
  }

  return (
    <div className="space-y-2">
      <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-2">
        <Package className="size-3.5 text-sky-600" />
        Select Formulation (Optional)
      </Label>
      {isLoadingForms ? (
        <div className="flex items-center gap-2 py-3 px-4 bg-muted/50 rounded-lg">
          <Loader2 className="size-4 animate-spin text-sky-600" />
          <span className="font-mono text-sm text-muted-foreground">
            Loading available formulations…
          </span>
        </div>
      ) : drugForms.length > 0 ? (
        <Select onValueChange={onDrugFormSelect}>
          <SelectTrigger className="font-mono">
            <SelectValue placeholder="Select a formulation to auto-fill dosage & route" />
          </SelectTrigger>
          <SelectContent className="z-[200] max-h-[300px]">
            {drugForms.map((form) => (
              <SelectItem
                key={form.rxcui}
                value={form.rxcui}
                className="font-mono"
              >
                <div className="flex flex-col">
                  <span className="font-medium">{form.strength} - {form.dose_form}</span>
                  <span className="text-xs text-muted-foreground">
                    Route: {getRouteLabel(form.route)}
                  </span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <p className="text-xs text-muted-foreground italic py-2">
          No specific formulations found. Enter dosage manually below.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Selecting a formulation will auto-fill the dosage and route
      </p>
    </div>
  );
}

function DosageField({ value, error, onFieldChange }) {
  return (
    <div className="space-y-2">
      <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
        Dosage *
      </Label>
      <Input
        placeholder="e.g., 500 MG, 10 ML, 2 tablets"
        value={value}
        onChange={(event) => onFieldChange('dosage', event.target.value)}
        className={cn(
          'font-mono',
          error && 'border-red-500',
        )}
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

function SelectField({ label, value, error, options, onValueChange }) {
  return (
    <div className="space-y-2">
      <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className={cn('font-mono', error && 'border-red-500')}>
          <SelectValue placeholder={`Select ${label.toLowerCase().replace(' *', '')}`} />
        </SelectTrigger>
        <SelectContent className="z-[200]">
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} className="font-mono">
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}

function RouteFrequencyFields({ formData, errors, onFieldChange }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <SelectField
        label="Route *"
        value={formData.route}
        error={errors.route}
        options={ROUTE_OPTIONS}
        onValueChange={(value) => onFieldChange('route', value)}
      />
      <SelectField
        label="Frequency *"
        value={formData.frequency}
        error={errors.frequency}
        options={FREQUENCY_OPTIONS}
        onValueChange={(value) => onFieldChange('frequency', value)}
      />
    </div>
  );
}

function DurationStartDateFields({ formData, onFieldChange }) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-2">
        <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
          Duration (days)
        </Label>
        <Input
          type="number"
          placeholder="e.g., 7, 14, 30"
          value={formData.duration_days}
          onChange={(event) => onFieldChange('duration_days', event.target.value)}
          className="font-mono"
        />
        <p className="text-xs text-muted-foreground">Leave empty for ongoing</p>
      </div>

      <div className="space-y-2">
        <Label className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
          <Calendar className="size-3.5" />
          Start Date
        </Label>
        <Input
          type="date"
          value={formData.start_date}
          onChange={(event) => onFieldChange('start_date', event.target.value)}
          className="font-mono"
        />
      </div>
    </div>
  );
}

function ReasonInstructionsFields({ formData, onFieldChange }) {
  return (
    <>
      <div className="space-y-2">
        <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
          Reason for Prescription
        </Label>
        <Input
          placeholder="e.g., Bacterial infection, Hypertension management"
          value={formData.reason}
          onChange={(event) => onFieldChange('reason', event.target.value)}
          className="font-mono"
        />
      </div>

      <div className="space-y-2">
        <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
          Special Instructions
        </Label>
        <Textarea
          placeholder="e.g., Take with food, Avoid alcohol, Take 30 minutes before meals"
          value={formData.instructions}
          onChange={(event) => onFieldChange('instructions', event.target.value)}
          className="font-mono min-h-[80px]"
        />
      </div>
    </>
  );
}

function MarGenerationPanel({
  available,
  generateMAR,
  marDays,
  isPatientAdmitted,
  onGenerateMARChange,
  onMarDaysChange,
}) {
  if (!available) {
    return (
      <Alert>
        <ClipboardList className="size-4" />
        <AlertDescription>
          MAR generation is not available in Rust V2 mode yet.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="p-4 bg-sky-50 dark:bg-sky-900/20 rounded-lg border border-sky-200 dark:border-sky-800">
      <div className="flex items-start gap-3">
        <Checkbox
          id="generate-mar"
          checked={generateMAR}
          onCheckedChange={(value) => onGenerateMARChange(Boolean(value))}
          className="mt-0.5"
        />
        <div className="flex-1 space-y-2">
          <Label
            htmlFor="generate-mar"
            className="font-mono text-sm font-medium cursor-pointer flex items-center gap-2"
          >
            <ClipboardList className="size-4 text-sky-600" />
            Generate Medication Administration Record (MAR)
          </Label>
          <p className="text-xs text-muted-foreground">
            Creates scheduled doses for nursing to administer and pharmacy to dispense.
            {isPatientAdmitted && (
              <span className="text-sky-600 font-medium"> Patient is currently admitted.</span>
            )}
          </p>
          {generateMAR && (
            <div className="flex items-center gap-2 pt-1">
              <Label className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                Generate for
              </Label>
              <Input
                type="number"
                min="1"
                max="30"
                value={marDays}
                onChange={(event) => onMarDaysChange(parseInt(event.target.value) || 7)}
                className="font-mono w-16 h-8 text-center"
              />
              <Label className="font-mono text-xs text-muted-foreground">
                days
              </Label>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PrescriptionSummary({ formData }) {
  if (!formData.medication_name || !formData.dosage) {
    return null;
  }

  return (
    <div className="p-4 bg-muted/50 rounded-lg border border-border">
      <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground mb-2">
        Prescription Summary
      </h3>
      <p className="font-mono text-sm">
        <span className="font-semibold">{formData.medication_name}</span>{' '}
        {formData.dosage}{' '}
        <span className="text-muted-foreground">
          via {getRouteLabel(formData.route)}
        </span>{' '}
        <span className="text-muted-foreground">
          {getFrequencyLabel(formData.frequency)}
        </span>
        {formData.duration_days && (
          <span className="text-muted-foreground"> for {formData.duration_days} days</span>
        )}
      </p>
      {formData.instructions && (
        <p className="font-mono text-xs text-muted-foreground mt-2">
          Instructions: {formData.instructions}
        </p>
      )}
    </div>
  );
}

export function PrescriptionFormContent({
  formData,
  errors,
  selectedRxcui,
  drugForms,
  isLoadingForms,
  drugSafetyEnhancementsAvailable,
  marGenerationAvailable,
  generateMAR,
  marDays,
  isPatientAdmitted,
  onMedicationSelect,
  onDrugFormSelect,
  onFieldChange,
  onGenerateMARChange,
  onMarDaysChange,
}) {
  return (
    <div className="flex-1 overflow-y-auto p-6 chronicle-scrollbar">
      <div className="space-y-6">
        <MedicationNameField
          formData={formData}
          errors={errors}
          drugSafetyEnhancementsAvailable={drugSafetyEnhancementsAvailable}
          onMedicationSelect={onMedicationSelect}
          onFieldChange={onFieldChange}
        />
        <DrugFormSelector
          drugSafetyEnhancementsAvailable={drugSafetyEnhancementsAvailable}
          selectedRxcui={selectedRxcui}
          drugForms={drugForms}
          isLoadingForms={isLoadingForms}
          onDrugFormSelect={onDrugFormSelect}
        />
        <DosageField
          value={formData.dosage}
          error={errors.dosage}
          onFieldChange={onFieldChange}
        />
        <RouteFrequencyFields formData={formData} errors={errors} onFieldChange={onFieldChange} />
        <DurationStartDateFields formData={formData} onFieldChange={onFieldChange} />
        <ReasonInstructionsFields formData={formData} onFieldChange={onFieldChange} />
        <MarGenerationPanel
          available={marGenerationAvailable}
          generateMAR={generateMAR}
          marDays={marDays}
          isPatientAdmitted={isPatientAdmitted}
          onGenerateMARChange={onGenerateMARChange}
          onMarDaysChange={onMarDaysChange}
        />
        <PrescriptionSummary formData={formData} />
      </div>
    </div>
  );
}

export function PrescriptionSlideOverFooter({
  isCreating,
  safetyCheckPending,
  onCancel,
  onSubmit,
}) {
  return (
    <footer className="px-6 py-4 border-t border-border bg-card">
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={onCancel}
          className="font-mono text-xs"
        >
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={onSubmit}
          disabled={isCreating || safetyCheckPending}
          className="font-mono text-xs"
        >
          {safetyCheckPending ? (
            <>
              <Shield className="size-3.5 mr-1.5 animate-pulse" />
              Checking Safety…
            </>
          ) : isCreating ? (
            'Creating…'
          ) : (
            <>
              <Check className="size-3.5 mr-1.5" />
              Create Prescription
            </>
          )}
        </Button>
      </div>
    </footer>
  );
}
