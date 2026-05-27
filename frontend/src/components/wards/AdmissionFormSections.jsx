import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DatePicker } from '@/components/ui/date-picker';
import { SearchBar } from '@/components/ui/search-bar';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export function AdmissionErrorCard({ error, onDismiss }) {
  if (!error) return null;

  return (
    <Card className="border-red-500 bg-red-50">
      <CardContent className="pt-6">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0">
            <svg className="size-5 text-red-500" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-medium text-red-800">Error creating admission</h3>
            <p className="mt-1 text-sm text-red-700">{error}</p>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="flex-shrink-0 text-red-500 hover:text-red-700"
          >
            <span className="sr-only">Dismiss</span>
            <svg className="size-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

export function AdmissionPatientSection({
  options,
  value,
  onChange,
  onInputChange,
  emptyMessage,
  disabled,
  isLoading,
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor="patient" className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
        Patient
      </Label>
      <SearchBar
        options={options}
        value={value}
        onChange={onChange}
        onInputChange={onInputChange}
        placeholder="Search for a patient..."
        emptyMessage={emptyMessage}
        searchPlaceholder="Search by name, MRN, or NHIS ID..."
        disabled={disabled}
        maxHeight="20rem"
        isLoading={isLoading}
      />
      <p className="text-xs text-muted-foreground">
        Search for a patient by name, medical record number (MRN), or NHIS ID.
      </p>
    </div>
  );
}

export function AdmissionTypeSection({ value, onChange }) {
  return (
    <div className="space-y-2">
      <Label htmlFor="admission_type" className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
        Admission Type
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id="admission_type">
          <SelectValue placeholder="Select admission type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="emergency">Emergency</SelectItem>
          <SelectItem value="elective">Elective</SelectItem>
          <SelectItem value="maternity">Maternity</SelectItem>
          <SelectItem value="newborn">Newborn</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

export function AdmissionDoctorSection({
  options,
  value,
  onChange,
  onInputChange,
  emptyMessage,
  disabled,
  isLoading,
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor="admitting_doctor" className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
        Admitting Doctor
      </Label>
      <SearchBar
        options={options}
        value={value}
        onChange={onChange}
        onInputChange={onInputChange}
        placeholder="Search for a doctor..."
        emptyMessage={emptyMessage}
        searchPlaceholder="Search by name, employee ID, or license number..."
        disabled={disabled}
        maxHeight="20rem"
        isLoading={isLoading}
      />
      <p className="text-xs text-muted-foreground">
        Search for a doctor by name, employee ID, or license number.
      </p>
    </div>
  );
}

export function AdmissionDateSection({
  admissionDate,
  expectedDischargeDate,
  onAdmissionDateChange,
  onExpectedDischargeDateChange,
}) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="admission_date" className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
          Admission Date
        </Label>
        <DatePicker
          date={admissionDate}
          setDate={onAdmissionDateChange}
          placeholder="Select admission date"
          className="font-mono text-sm"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="expected_discharge_date" className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
          Expected Discharge Date (Optional)
        </Label>
        <DatePicker
          date={expectedDischargeDate}
          setDate={onExpectedDischargeDateChange}
          placeholder="Select discharge date"
          className="font-mono text-sm"
        />
      </div>
    </>
  );
}

export function AdmissionNotesSection({ value, onChange }) {
  return (
    <div className="space-y-2">
      <Label htmlFor="admission_notes" className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
        Admission Notes
      </Label>
      <Textarea
        id="admission_notes"
        name="admission_notes"
        value={value}
        onChange={onChange}
        placeholder="Enter any notes about the admission..."
        rows={4}
      />
    </div>
  );
}

export function AdmissionDetailsCard({ children }) {
  return (
    <Card className="border-border">
      <CardHeader className="pb-4">
        <CardTitle className="font-display text-xl">Patient Details</CardTitle>
        <CardDescription className="font-mono text-xs">
          Enter the details for patient admission
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">{children}</CardContent>
    </Card>
  );
}

export function AdmissionFormActions({ submitting, canSubmit, selectedBed, onCancel }) {
  return (
    <div className="flex justify-end gap-4">
      <Button
        type="button"
        variant="outline"
        onClick={onCancel}
        disabled={submitting}
      >
        Cancel
      </Button>
      <Button
        type="submit"
        disabled={submitting || !canSubmit}
      >
        {submitting ? 'Submitting Admission...' : selectedBed ? 'Admit Patient' : 'Start Admission'}
      </Button>
    </div>
  );
}

export function AdmissionValidationDialog({ open, onOpenChange, message }) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Validation Error</AlertDialogTitle>
          <AlertDialogDescription>
            {message}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction>OK</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
