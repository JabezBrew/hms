import format from 'date-fns/format';
import DoctorAvailabilityCalendar from '@/components/appointments/DoctorAvailabilityCalendar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DateTimePicker } from '@/components/ui/date-time-picker';
import { SearchBar } from '@/components/ui/search-bar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';

export function EncounterLoadingState() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

export function EncounterErrorState({ message }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-red-500">Error</CardTitle>
      </CardHeader>
      <CardContent>
        <p>{message}</p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => window.location.reload()}
        >
          Try Again
        </Button>
      </CardContent>
    </Card>
  );
}

export function EncounterPatientField({
  control,
  disabled,
  isEditing,
  isLoadingPatients,
  patientOptions,
  onPatientSearch,
}) {
  return (
    <FormField
      control={control}
      name="patient_id"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Patient</FormLabel>
          <FormControl>
            <SearchBar
              options={patientOptions}
              value={field.value}
              onChange={field.onChange}
              onInputChange={onPatientSearch}
              placeholder="Search for a patient..."
              emptyMessage={isLoadingPatients ? 'Searching...' : 'No patients found.'}
              searchPlaceholder="Search by name, MRN, or NHIS ID..."
              disabled={disabled || isEditing}
              maxHeight="20rem"
              isLoading={isLoadingPatients}
            />
          </FormControl>
          <p className="text-xs text-muted-foreground">
            Search for a patient by name, medical record number (MRN), or NHIS ID.
          </p>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function EncounterTypeField({ control, disabled, isEditing, rustV2Mode, status }) {
  return (
    <FormField
      control={control}
      name="encounter_type"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Encounter Type</FormLabel>
          <Select
            value={field.value}
            onValueChange={field.onChange}
            disabled={disabled || (!rustV2Mode && isEditing && status !== 'planned')}
          >
            <FormControl>
              <SelectTrigger>
                <SelectValue placeholder="Select encounter type" />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              <SelectItem value="outpatient">Outpatient</SelectItem>
              {!rustV2Mode && (
                <SelectItem value="inpatient">Inpatient</SelectItem>
              )}
              <SelectItem value="emergency">Emergency</SelectItem>
              {rustV2Mode && <SelectItem value="triage">Triage</SelectItem>}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            The type of encounter determines the workflow and required information.
          </p>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function EncounterStatusField({ control, disabled }) {
  return (
    <FormField
      control={control}
      name="status"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Status</FormLabel>
          <Select
            value={field.value}
            onValueChange={field.onChange}
            disabled={disabled}
          >
            <FormControl>
              <SelectTrigger>
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              <SelectItem value="planned">Planned</SelectItem>
              <SelectItem value="in-progress">In Progress</SelectItem>
              <SelectItem value="finished">Finished</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function EncounterPractitionerField({
  control,
  disabled,
  isLoadingPractitioners,
  practitionerOptions,
  onPractitionerSearch,
}) {
  return (
    <FormField
      control={control}
      name="practitioner_id"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Practitioner</FormLabel>
          <FormControl>
            <SearchBar
              options={practitionerOptions}
              value={field.value}
              onChange={field.onChange}
              onInputChange={onPractitionerSearch}
              placeholder="Search for a practitioner..."
              emptyMessage={isLoadingPractitioners ? 'Searching...' : 'No practitioners found.'}
              searchPlaceholder="Search by name, employee ID, or license number..."
              disabled={disabled}
              maxHeight="20rem"
              isLoading={isLoadingPractitioners}
            />
          </FormControl>
          <p className="text-xs text-muted-foreground">
            Search for a doctor, nurse, or other healthcare provider.
          </p>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function EncounterReasonField({ control, disabled }) {
  return (
    <FormField
      control={control}
      name="reason"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Reason for Visit</FormLabel>
          <FormControl>
            <Textarea
              placeholder="Enter the reason for this encounter..."
              rows={2}
              disabled={disabled}
              {...field}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function EncounterServiceTypeField({ control, disabled }) {
  return (
    <FormField
      control={control}
      name="service_type"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Service Type</FormLabel>
          <Select
            value={field.value}
            onValueChange={field.onChange}
            disabled={disabled}
          >
            <FormControl>
              <SelectTrigger>
                <SelectValue placeholder="Select service type" />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="General Practice">General Practice</SelectItem>
              <SelectItem value="Cardiology">Cardiology</SelectItem>
              <SelectItem value="Neurology">Neurology</SelectItem>
              <SelectItem value="Orthopedics">Orthopedics</SelectItem>
              <SelectItem value="Pediatrics">Pediatrics</SelectItem>
              <SelectItem value="Obstetrics">Obstetrics</SelectItem>
              <SelectItem value="Gynecology">Gynecology</SelectItem>
              <SelectItem value="Emergency Medicine">Emergency Medicine</SelectItem>
              <SelectItem value="Surgery">Surgery</SelectItem>
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function EncounterAvailabilityField({
  practitionerId,
  startTime,
  endTime,
  slotSelected,
  onSlotSelect,
}) {
  if (!practitionerId) {
    return null;
  }

  return (
    <>
      <div className="rounded-md border p-4">
        <h3 className="mb-4 text-sm font-medium">Practitioner Availability</h3>
        <DoctorAvailabilityCalendar
          practitionerId={practitionerId}
          onSlotSelect={onSlotSelect}
        />
      </div>

      {slotSelected && startTime && (
        <div className="rounded-md border bg-muted/50 p-4">
          <div className="flex flex-col gap-y-1">
            <span className="text-sm font-medium text-muted-foreground">Selected Time</span>
            <span className="text-lg font-semibold">
              {format(startTime, 'MMMM d, yyyy hh:mm a')}
              {endTime && ` - ${format(endTime, 'hh:mm a')}`}
            </span>
          </div>
        </div>
      )}
    </>
  );
}

function EncounterManualTimeFields({ control, disabled, endTimeDisabled }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <FormField
        control={control}
        name="start_time"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Start Time</FormLabel>
            <FormControl>
              <DateTimePicker
                date={field.value}
                setDate={field.onChange}
                disabled={disabled}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={control}
        name="end_time"
        render={({ field }) => (
          <FormItem>
            <FormLabel>End Time (Optional)</FormLabel>
            <FormControl>
              <DateTimePicker
                date={field.value}
                setDate={field.onChange}
                disabled={disabled || endTimeDisabled}
              />
            </FormControl>
            <p className="text-xs text-muted-foreground">
              Only set an end time for completed or cancelled encounters.
            </p>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}

function EncounterLocationField({ control, disabled }) {
  return (
    <FormField
      control={control}
      name="location"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Location</FormLabel>
          <Select
            value={field.value}
            onValueChange={field.onChange}
            disabled={disabled}
          >
            <FormControl>
              <SelectTrigger>
                <SelectValue placeholder="Select location" />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="Main Hospital">Main Hospital</SelectItem>
              <SelectItem value="Outpatient Clinic">Outpatient Clinic</SelectItem>
              <SelectItem value="Emergency Department">Emergency Department</SelectItem>
              <SelectItem value="Surgical Center">Surgical Center</SelectItem>
              <SelectItem value="Radiology">Radiology</SelectItem>
              <SelectItem value="Laboratory">Laboratory</SelectItem>
              <SelectItem value="Physical Therapy">Physical Therapy</SelectItem>
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function EncounterAdmissionSourceField({ control, disabled }) {
  return (
    <FormField
      control={control}
      name="admission_source"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Admission Source</FormLabel>
          <Select
            value={field.value}
            onValueChange={field.onChange}
            disabled={disabled}
          >
            <FormControl>
              <SelectTrigger>
                <SelectValue placeholder="Select admission source" />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="hosp-trans">Transferred from another hospital</SelectItem>
              <SelectItem value="emd">From emergency department</SelectItem>
              <SelectItem value="outp">From outpatient department</SelectItem>
              <SelectItem value="born">Born in hospital</SelectItem>
              <SelectItem value="gp">General Practitioner referral</SelectItem>
              <SelectItem value="mp">Medical Practitioner/physician referral</SelectItem>
              <SelectItem value="nursing">From nursing home</SelectItem>
              <SelectItem value="psych">From psychiatric hospital</SelectItem>
              <SelectItem value="rehab">From rehabilitation facility</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function LegacyEncounterFields({
  control,
  disabled,
  encounterType,
  endTimeDisabled,
  isLoadingPractitioners,
  practitionerId,
  practitionerOptions,
  showManualTime,
  slotSelected,
  startTime,
  endTime,
  onPractitionerSearch,
  onSlotSelect,
}) {
  return (
    <>
      <EncounterStatusField control={control} disabled={disabled} />
      <EncounterPractitionerField
        control={control}
        disabled={disabled}
        isLoadingPractitioners={isLoadingPractitioners}
        practitionerOptions={practitionerOptions}
        onPractitionerSearch={onPractitionerSearch}
      />
      <EncounterReasonField control={control} disabled={disabled} />
      <EncounterServiceTypeField control={control} disabled={disabled} />
      <EncounterAvailabilityField
        practitionerId={practitionerId}
        startTime={startTime}
        endTime={endTime}
        slotSelected={slotSelected}
        onSlotSelect={onSlotSelect}
      />
      {showManualTime && (
        <EncounterManualTimeFields
          control={control}
          disabled={disabled}
          endTimeDisabled={endTimeDisabled}
        />
      )}
      <EncounterLocationField control={control} disabled={disabled} />
      {encounterType === 'inpatient' && (
        <EncounterAdmissionSourceField control={control} disabled={disabled} />
      )}
    </>
  );
}

export function EncounterFormActions({ disabled, isEditing, submitting, onCancel }) {
  return (
    <div className="flex justify-end gap-4 pt-4">
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
        disabled={disabled}
      >
        {submitting ? 'Saving...' : isEditing ? 'Update Encounter' : 'Create Encounter'}
      </Button>
    </div>
  );
}
